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
        async _fetch(url, json) {
            switch (url) {
                case this._assetsUrl + 'manifest.json': return _manifest;
                case this._assetsUrl + 'test/index.html': return _index;
                case this._apiUrl + 'config.json': return _config;
                default: throw new Error(`URL not matched: ${url}`);
            }
        }
    }

    it('should download manifest when instantiated', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");
        const res = await router._manifestPromise;

        assert.deepEqual(res, _manifest);
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

    it('should fetch app index when hitting a sub-path of the app', async function () {
        const router = new TestRouter("https://localhost/asset-url/", "https://localhost/api-url/");

        const res1 = await router.route("/test/");
        const res2 = await router.route("/test/sub-path");

        assert.equal(res1.statusCode, 200);
        assert.deepEqual(res1, res2);

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
});
