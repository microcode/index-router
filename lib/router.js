const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const log = require('debug')('index-router');

const pathPattern = /^\/([A-Za-z0-9]+)(\/.*)?$/;
const appcachePattern = /^.*\.appcache$/i;
const linkPattern = /^(?!(?:https?:)?\/)/i;
const configSrcPattern = /.*\/config\.js/;

class Router {
    constructor(assetsUrl, apiUrl) {
        this._assetsUrl = assetsUrl;
        this._apiUrl = apiUrl;

        this._manifestPromise = this.fetchManifest();
        this._configPromise = this.fetchConfig();

        this._indexesPromise = this._manifestPromise.then(manifest => this.fetchIndexes(manifest));
    }

    async fetchConfig() {
        log("Downloading config");

        const url = this._apiUrl + 'config.json';
        const config = await this._fetch(url, { json: true });

        return Object.assign({
            assets_url: this._assetsUrl,
            api_url: this._apiUrl,
        }, config);
    }

    async fetchIndexes(manifest) {
        log(`Downloading indexes for '${manifest.apps}'`);

        const indexes = await Promise.all(manifest.apps.map(app => {
            const url = this._assetsUrl + app + '/index.html';
            return this._fetch(url).then(data => [app, data]);
        }));

        return indexes.reduce((map, index) => {
            map[index[0]] = index[1];
            return map;
        }, {});
    }

    async route(path, options) {
        try {
            options = Object.assign({
                clientAge: 60,
                cacheAge: 300
            }, options);

            const response = await this._route(path, options);
            return response;
        } catch (err) {
            log("Request failed", err);
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': this._createCacheResponse(10)
                },
                body: JSON.stringify({
                    error: 'Internal error'
                })
            }
        }
    }

    async _route(path, options) {
        log(`Routing path '${path}'`);

        const manifest = await this._manifestPromise;

        if ('/' === path) {
            log("Root redirect to default app", manifest.default);
            return {
                statusCode: 301,
                headers: {
                    'Location': '/' + manifest.default + '/',
                    'Cache-Control': this._createCacheResponse(options.clientAge, options.cacheAge)
                }
            };
        }

        const match = pathPattern.exec(path);
        if (!match) {
            log("Invalid path detected");
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': this._createCacheResponse(options.clientAge)
                },
                body: JSON.stringify({
                    error: 'Invalid path'
                })
            };
        }

        const app = match[1];

        if (!manifest.apps.includes(app)) {
            log("Application not found");
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': this._createCacheResponse(options.clientAge)
                },
                body: JSON.stringify({
                    error: 'Application not found'
                })
            };
        }

        const appPath = match[2];
        if (!appPath) {
            log("Redirect to app", app);
            return {
                statusCode: 301,
                headers: {
                    'Location': '/' + app + '/',
                    'Cache-Control': this._createCacheResponse(options.clientAge, options.cacheAge)
                }
            };
        }

        if (appcachePattern.test(appPath)) {
            log("App cache fetch detected, blocking");
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': this._createCacheResponse(options.clientAge)
                },
                body: JSON.stringify({
                    error: 'Application cache not found'
                })
            };
        }

        const html = await this.getSiteIndex(app);
        const config = await this._configPromise.then(config => Object.assign({
            target: [ '/' + app + '/' ]
        }, config, manifest.config));

        const body = await this.transform(app, html, config);

        log("Returning body content for",app);
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': this._createCacheResponse(options.clientAge, options.cacheAge)
            },
            body
        };
    }

    async transform(app, html, config) {
        const jsdom = new JSDOM(html);
        const document = jsdom.window.document;

        this.relocate(document, "link", "href");
        this.relocate(document, "script", "src");

        this.patchConfig(app, document, config);

        return jsdom.serialize();
    }

    _createCacheResponse(clientAge, cacheAge) {
        const response = {
            "max-age": clientAge,
            "s-max-age": cacheAge
        };

        return Object.keys(response).map(key => {
            const value = response[key];
            if (value === undefined) {
                return undefined;
            }
            return key + "=" + value;
        }).join(", ");
    }

    relocate(document, tag, attr) {
        log(`Relocating ${tag} elements`);

        const elements = document.getElementsByTagName(tag);

        for (let element of elements) {
            const src = element.getAttribute(attr);
            if (!linkPattern.test(src)) {
                continue;
            }

            element.setAttribute(attr,this._assetsUrl + src);
        }
    }

    patchConfig(app, document, config) {
        log("Patching config");

        const configString = "_app_config = " + JSON.stringify(config) + ";";

        Array
            .from(document.getElementsByTagName("script"))
            .filter(script => configSrcPattern.test(script.getAttribute("src")))
            .forEach(script => {
                script.removeAttribute("src");
                script.innerHTML = configString;
            })
    }

    async getSiteIndex(app) {
        log("Fetching site index for", app);

        const indexes = await this._indexesPromise;

        const index = indexes[app];
        if (!index) {
            throw new Error(`Index not found for ${app}`);
        }

        return index;
    }

    fetchManifest() {
        const url = this._assetsUrl + 'manifest.json';

        log("Fetching manifest");
        return this._fetch(url, { json: true });
    }

    async _fetch(url, options) {
        options = Object.assign({
            json: false
        }, options);

        log(`Downloading from ${url} (json: ${options.json})`);
        const res = await fetch(url);

        if (options.json) {
            return res.json();
        } else {
            return res.text();
        }
    }
}

exports.Router = Router;
