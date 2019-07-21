const { Router } = require('./lib/router');

const assetsUrl = process.env['ASSETS_URL'];
const apiUrl = process.env['API_URL'];

const router = new Router(assetsUrl, apiUrl);

exports.handler = async function (event) {
    return router.route(event.path);
};
