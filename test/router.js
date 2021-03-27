const assert = require('assert').strict;

const { JSDOM } = require('jsdom');
const { Router } = require('../lib/router');

describe('Router', function () {
    const _manifest = {
        hash: 'TESTHASH',
        apps: [ 'test' ],
        default: 'test',
        config: {
            timestamp: 1234,
            clientVersion: "1.0",
        }
    };

    const _config = {
        "cdn_prefix": "https://localhost/",
        "idle_timeout": 1800000
    };

    const _index = "" +
        "<html>" +
        "   <head>" +
        "       <link href=\"test/style.css\" rel=\"stylesheet\">" +
        "   </head>" +
        "   <body>" +
        "       <script src=\"/home/config.js\"></script>" +
        "       <script type=\"text/javascript\" src=\"//external-site/script.js\"></script>" +
        "       <script type=\"text/javascript\" src=\"test/app.js\"></script>" +
        "   </body>" +
        "</html>";

    class TestRouter extends Router {
        async _doFetch(url, options) {
            switch (url) {
                case this._assetsUrl + 'manifest.json': return _manifest;
                case this._assetsUrl + 'test/index.html': return _index;
                case this._apiUrl + 'config.json': return _config;
                default: throw new Error(`URL not matched: ${url}`);
            }
        }
    }

    it('should download manifest when routing', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res = await router.route("/");
        const manifest = await router._manifestPromise;

        assert.equal(res.statusCode, 301);
        assert.deepEqual(manifest, _manifest);
    });

    it('should redirect when accessing root path', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");
        const res = await router.route("/");

        assert.equal(res.statusCode, 301);
        assert.equal(res.headers['Location'], '/' + _manifest.default + '/');
    });

    it('should fail if accessing incomplete path', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");
        const res = await router.route("/incomplete");

        assert.equal(res.statusCode, 404);
    });

    it('should fail if accessing invalid app', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");
        const res = await router.route("/invalid/");

        assert.equal(res.statusCode, 404);
    });

    it('should fetch app index when hitting the correct URL', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");
        const res = await router.route("/test/");

        assert.equal(res.statusCode, 200);
    });

    it('should redirect to app index when hitting a sub-path of the app', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res1 = await router.route("/test/");
        const res2 = await router.route("/test/sub-path");

        assert.equal(res1.statusCode, 200);

        assert.equal(res2.statusCode, 301);
        assert.equal(res2.headers['Location'], '/test/#sub-path');
    });

    it('should rewrite relative URLs in app index', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res = await router.route("/test/");

        assert.equal(res.statusCode, 200);

        const jsdom = new JSDOM(res.body);
        const document = jsdom.window.document;

        const links = document.getElementsByTagName("link");
        assert.equal(links.length, 1);
        for (let link of links) {
            assert(link.getAttribute("href").startsWith(router._assetsUrl));
        }

        const scripts = Array.from(document.getElementsByTagName("script"));
        assert.equal(scripts.length, 3);

        assert.equal(1, scripts.filter(script => {
            return script.hasAttribute("src");
        }).filter(script => {
            return script.getAttribute("src").startsWith(router._assetsUrl);
        }).length);
    });

    it('should patch the config script', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");
        const res = await router.route("/test/");

        assert.equal(res.statusCode, 200);

        const jsdom = new JSDOM(res.body);
        const document = jsdom.window.document;
        const script = Array.from(document.getElementsByTagName("script")).find(script => !script.hasAttribute("src"));

        assert(script !== undefined);
        const json = JSON.parse(/.* = ({.*}).*/.exec(script.innerHTML)[1]);

        assert.equal(json.hash, _config.hash);
        assert.equal(json.assets_url, router._assetsUrl);
        assert.equal(json.api_url, router._apiUrl);
    });

    it('should retry if the config fetch failed initially', async function () {
        let count = 0;

        class BadConfigRouter extends Router {
            async _doFetch(url, options) {
                switch (url) {
                    case this._assetsUrl + 'manifest.json': return _manifest;
                    case this._assetsUrl + 'test/index.html': return _index;
                    case this._apiUrl + 'config.json': {
                        ++count;
                        throw new Error("Bad config");
                    }
                    default: throw new Error(`URL not matched: ${url}`);
                }
            }
        }

        const router = new BadConfigRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res1 = await router.route("/test/");
        const res2 = await router.route("/test/");

        assert.equal(res1.statusCode, 500);
        assert.equal(res2.statusCode, 500);
        assert.equal(count, 6);
    });

    it('should retry if the manifest fetch failed initially', async function () {
        let count = 0;

        class BadManifestRouter extends Router {
            async _doFetch(url, options) {
                switch (url) {
                    case this._assetsUrl + 'manifest.json': {
                        ++count;
                        throw new Error("Bad manifest");
                    }
                    case this._assetsUrl + 'test/index.html': return _index;
                    case this._apiUrl + 'config.json': return _config;
                    default: throw new Error(`URL not matched: ${url}`);
                }
            }
        }

        const router = new BadManifestRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res1 = await router.route("/test/");
        const res2 = await router.route("/test/");

        assert.equal(res1.statusCode, 500);
        assert.equal(res2.statusCode, 500);
        assert.equal(count, 6);
    });

    it('should retry if the index fetch failed initially', async function () {
        let count = 0;

        class BadIndexRouter extends Router {
            async _doFetch(url, options) {
                switch (url) {
                    case this._assetsUrl + 'manifest.json': return _manifest;
                    case this._assetsUrl + 'test/index.html': {
                        ++count;
                        throw new Error("Bad manifest");
                    }
                    case this._apiUrl + 'config.json': return _config;
                    default: throw new Error(`URL not matched: ${url}`);
                }
            }
        }

        const router = new BadIndexRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res1 = await router.route("/test/");
        const res2 = await router.route("/test/");

        assert.equal(res1.statusCode, 500);
        assert.equal(res2.statusCode, 500);
        assert.equal(count, 6);
    });

    it('should return the proper exception when failing to download manifest', async function () {
        class BadResponse {
            constructor() {
                this.ok = false;
                this.status = 500;
                this.statusText = "Internal Error";
            }

            async text() {
                return "Access Denied";
            }

            async json() {
                return "Access Denied";
            }
        }

        class BadIndexRouter extends Router {
            async _rawFetch(url) {
                switch (url) {
                    default: return new BadResponse();
                }
            }
        }

        const router = new BadIndexRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res = await router.route("/test/");

        assert.equal(res.statusCode, 500);

        assert.equal(router._manifestPromise, undefined);
        assert.equal(router._configPromise, undefined);
        assert.deepEqual(router._indexes, {});
    });

    it('should return the proper exception when failing to download config', async function () {
        class ManifestResponse {
            constructor() {
                this.ok = true;
                this.status = 200;
                this.statusText = "OK";
            }

            async json() {
                return _manifest;
            }
        }

        class BadResponse {
            constructor() {
                this.ok = false;
                this.status = 500;
                this.statusText = "Internal Error";
            }

            async text() {
                return "Access Denied";
            }

            async json() {
                return "Access Denied";
            }
        }

        class IndexResponse {
            constructor() {
                this.ok = true;
                this.status = 200;
                this.statusText = "OK";
            }

            async text() {
                return _index;
            }
        }

        class BadIndexRouter extends Router {
            async _rawFetch(url) {
                switch (url) {
                    case this._assetsUrl + 'manifest.json': return new ManifestResponse();
                    case this._assetsUrl + 'test/index.html': return new IndexResponse();
                    default: return new BadResponse();
                }
            }
        }

        const router = new BadIndexRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res = await router.route("/test/");

        assert.equal(res.statusCode, 500);

        assert.notEqual(router._manifestPromise, undefined);
        assert.equal(router._configPromise, undefined);
        assert.equal(await Promise.resolve(router._indexes["test"]), _index);
    });

    it('should return the proper exception when failing to download index', async function () {
        class ManifestResponse {
            constructor() {
                this.ok = true;
                this.status = 200;
                this.statusText = "OK";
            }

            async json() {
                return _manifest;
            }
        }

        class IndexResponse {
            constructor() {
                this.ok = true;
                this.status = 200;
                this.statusText = "OK";
            }

            async text() {
                return _index;
            }
        }


        class BadResponse {
            constructor() {
                this.ok = false;
                this.status = 500;
                this.statusText = "Internal Error";
            }

            async text() {
                return "Access Denied";
            }

            async json() {
                return "Access Denied";
            }
        }

        class BadIndexRouter extends Router {
            async _rawFetch(url) {
                switch (url) {
                    case this._assetsUrl + 'manifest.json': return new ManifestResponse();
                    default: return new BadResponse();
                }
            }
        }

        const router = new BadIndexRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res = await router.route("/test/");

        assert.equal(res.statusCode, 500);

        assert.notEqual(router._manifestPromise, undefined);
        assert.equal(router._configPromise, undefined);
        assert.deepEqual(router._indexes, {"test": undefined});
    });

    it('should cache the appropriate data when everything downloads properly', async function () {
        class ManifestResponse {
            constructor() {
                this.ok = true;
                this.status = 200;
                this.statusText = "OK";
            }

            async json() {
                return _manifest;
            }
        }

        class ConfigResponse {
            constructor() {
                this.ok = true;
                this.status = 200;
                this.statusText = "OK";
            }

            async json() {
                return _config;
            }
        }

        class IndexResponse {
            constructor() {
                this.ok = true;
                this.status = 200;
                this.statusText = "OK";
            }

            async text() {
                return _index;
            }
        }


        class BadResponse {
            constructor() {
                this.ok = false;
                this.status = 500;
                this.statusText = "Internal Error";
            }

            async text() {
                return "Access Denied";
            }

            async json() {
                return "Access Denied";
            }
        }

        class BadIndexRouter extends Router {
            async _rawFetch(url) {
                switch (url) {
                    case this._assetsUrl + 'manifest.json': return new ManifestResponse();
                    case this._apiUrl + 'config.json': return new ConfigResponse();
                    default: return new IndexResponse();
                }
            }
        }

        const router = new BadIndexRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res = await router.route("/test/");

        assert.equal(res.statusCode, 200);

        const _finalConfig = Object.assign({
            "assets_url": "https://localhost/asset-url/",
            "api_url": "https://localhost/api-url/",
        }, _config);

        assert.equal(await Promise.resolve(router._manifestPromise), _manifest);
        assert.deepEqual(await Promise.resolve(router._configPromise), _finalConfig);
        assert.equal(await Promise.resolve(router._indexes["test"]), _index);
    });
});
