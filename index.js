const { Router } = require('./lib/router');

const log = require('debug')('index-router');

const routers = {};

exports.handler = async function (event, context) {
    log("Event", event);
    log("Context", context);

    const router = (() => {
        const stage = event.requestContext.stage;

        const _r = routers[stage];
        if (_r) {
            log(`Retrieving router for '${stage}'`);
            return _r;
        }

        const assetsUrl = event.stageVariables['ASSETS_URL'];
        const apiUrl = event.stageVariables['API_URL'];

        log(`Created router for '${stage}':`, { assetsUrl, apiUrl });

        const _n = new Router(assetsUrl, apiUrl);
        routers[stage] = _n;

        return _n;
    })();

    return router.route(event.path ? event.path : '/');
};
