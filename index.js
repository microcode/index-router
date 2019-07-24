const { Router } = require('./lib/router');

const log = require('debug')('index-router');
const crypto = require('crypto');

const routers = {};

exports.handler = async function (event, context) {
    log("Event", event);
    log("Context", context);

    const router = (() => {
        const assetsUrl = event.stageVariables['ASSETS_URL'];
        const apiUrl = event.stageVariables['API_URL'];
        const stage = event.requestContext.stage;

        const hash = crypto.createHash('md5').update(assetsUrl).update(apiUrl).update(stage).digest('hex');

        const _r = routers[hash];
        if (_r) {
            log(`Retrieving router for '${stage} (${hash})'`);
            return _r;
        }

        log(`Created router for '${stage} (${hash})':`, { assetsUrl, apiUrl });

        const _n = new Router(assetsUrl, apiUrl);
        routers[hash] = _n;

        return _n;
    })();

    return router.route(event.path ? event.path : '/');
};
