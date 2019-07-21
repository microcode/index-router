const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const log = require('debug')('index-router');

const pathPattern = /^\/([A-Za-z0-9]+)(\/.*)$/;
const appcachePattern = /^.*\.appcache$/i;
const linkPattern = /^(?!(?:https?:)?\/)/i;
const configPattern = /.* = ({.*}).*/;
const configSrcPattern = /.*\/config\.js/;

class Router {
    constructor(assetsUrl, apiUrl) {
        this._assetsUrl = assetsUrl;
        this._apiUrl = apiUrl;

        this._manifestPromise = this.fetchManifest();
    }

    async getConfig(app, manifest) {
        const url = this._apiUrl + app + '/config.js';
        const appConfig = await this._fetch(url);

        const match = configPattern.exec(appConfig);
        if (!match) {
            throw new Error("Could not find config");
        }

        const json = JSON.parse(match[1]);

        return Object.assign({
            assets_url: this._assetsUrl,
            api_url: this._apiUrl,
        }, json);
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
        const manifest = await this._manifestPromise;

        if ('/' === path) {
            return {
                statusCode: 301,
                headers: {
                    'Location': '/' + manifest.default + '/'
                }
            };
        }

        const match = pathPattern.exec(path);
        if (!match) {
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

        const [config,html] = await Promise.all([
            await this.getConfig(app, manifest),
            await this.getSiteIndex(app)
        ]);

        const body = await this.transform(html, config);
        return {
            statusCode: 200,
            headers: {
                'content-type': 'text/html'
            },
            body
        };
    }

    async transform(html, config) {
        const jsdom = new JSDOM(html);
        const document = jsdom.window.document;

        this.relocate(document, "link", "href");
        this.relocate(document, "script", "src");

        this.patchConfig(document, config);

        return jsdom.serialize();
    }

    relocate(document, tag, attr) {
        const elements = document.getElementsByTagName(tag);

        for (let element of elements) {
            const src = element.getAttribute(attr);
            if (!linkPattern.test(src)) {
                continue;
            }

            element.setAttribute(attr,this._assetsUrl + src);
        }
    }

    patchConfig(document, config) {
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
        return this._fetch(url);
    }

    fetchManifest() {
        return this._fetch(this._assetsUrl + 'manifest.json', { json: true });
    }

    async _fetch(url, options) {
        options = Object.assign({
            json: false
        }, options);

        const res = await fetch(url);

        if (options.json) {
            return res.json();
        } else {
            return res.text();
        }
    }
}

exports.Router = Router;
