const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const log = require('debug')('index-router');

const pathPattern = /^\/([A-Za-z0-9\-_]+)(\/.*)?$/;
const appcachePattern = /^.*\.appcache$/i;
const linkPattern = /^(?!(?:https?:)?\/)/i;
const configSrcPattern = /.*\/config\.js/;

class Router {
    constructor(assetsUrl, apiUrl) {
        this._assetsUrl = assetsUrl;
        this._apiUrl = apiUrl;

        this._manifestPromise = undefined;
        this._configPromise = undefined;
        this._indexesPromise = undefined;
    }

    async fetchConfig() {
        log("Downloading config");

        if (this._configPromise) {
            return this._configPromise;
        }

        const url = this._apiUrl + 'config.json';
        const config = await this._fetch(url, { json: true });

        this._configPromise = Object.assign({
            assets_url: this._assetsUrl,
            api_url: this._apiUrl,
        }, config);

        return this._configPromise;
    }

    async fetchIndexes() {
        const manifest = await this.fetchManifest();

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
                    'Cache-Control': 'no-store'
                },
                body: JSON.stringify({
                    error: 'Internal error'
                })
            }
        }
    }

    async _route(path, options) {
        log(`Routing path '${path}'`);

        const manifest = await this.fetchManifest();

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

        if (appPath.length > 1) {
            log(`Redirect to path inside ${app}: ${appPath}`);
            return {
                statusCode: 301,
                headers: {
                    'Location': '/' + app + '/#' + appPath.substring(1),
                    'Cache-Control': this._createCacheResponse(options.clientAge, options.cacheAge)
                }
            };
        }

        const html = await this.getSiteIndex(app);
        const config = await this.fetchConfig().then(config => Object.assign({
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
            "s-maxage": cacheAge
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

        const indexes = await this.fetchIndexes();

        const index = indexes[app];
        if (!index) {
            throw new Error(`Index not found for ${app}`);
        }

        return index;
    }

    fetchManifest() {
        if (this._manifestPromise) {
            return this._manifestPromise;
        }

        const url = this._assetsUrl + 'manifest.json';

        log("Fetching manifest");
        this._manifestPromise = this._fetch(url, { json: true });

        return this._manifestPromise;
    }

    async _fetch(url, options) {
        options = Object.assign({
            json: false,
            retries: 3
        }, options);

        return (async retries => {
            let attempt = 1;
            while (attempt <= retries) {
                try {
                    log(`Downloading from ${url} (json: ${options.json}) (attempt: ${attempt} / ${retries})`);
                    return await this._rawFetch(url, options);
                } catch (e) {
                    ++ attempt;
                    if (attempt > retries) {
                        throw e;
                    }
                }
            }
        })(options.retries);
    }

    async _rawFetch(url, options) {
        const res = await fetch(url);
        if (options.json) {
            return res.json();
        } else {
            return res.text();
        }
    }
}

exports.Router = Router;
