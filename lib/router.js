const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const log = require('debug')('index-router');

const pathPattern = /^\/([A-Za-z0-9]+)(\/.*)$/;
const appcachePattern = /^.*\.appcache$/i;
const linkPattern = /^(?!(?:https?:)?\/)/i;
const configSrcPattern = /.*\/config\.js/;

class Router {
    constructor(assetsUrl, apiUrl) {
        this._assetsUrl = assetsUrl;
        this._apiUrl = apiUrl;

        this._manifestPromise = this.fetchManifest();
        this._configPromise = this.fetchConfig();
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

    async route(path) {
        try {
            return await this._route(path);
        } catch (err) {
            log("Request failed", err);
            return {
                statusCode: 500,
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Internal error'
                })
            }
        }
    }

    async _route(path) {
        log(`Routing path '${path}'`);

        const manifest = await this._manifestPromise;

        if ('/' === path) {
            log("Root redirect to default app", manifest.default);
            return {
                statusCode: 301,
                headers: {
                    'Location': '/' + manifest.default + '/'
                }
            };
        }

        const match = pathPattern.exec(path);
        if (!match) {
            log("Invalid path detected");
            return {
                statusCode: 404,
                headers: {
                    'content-type': 'application/json'
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
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Application not found'
                })
            };
        }

        const appPath = match[2];
        if (appcachePattern.test(appPath)) {
            log("App cache fetch detected, blocking");
            return {
                statusCode: 404,
                headers: {
                    'content-type': 'application/json'
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
                'content-type': 'text/html'
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

    getSiteIndex(app) {
        const url = this._assetsUrl + app + '/index.html';

        log("Fetching site index for", app);
        return this._fetch(url);
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

        log(`Downloading from ${url} (json: ${options.json})`)
        const res = await fetch(url);

        if (options.json) {
            return res.json();
        } else {
            return res.text();
        }
    }
}

exports.Router = Router;
