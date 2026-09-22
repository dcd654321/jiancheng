// Active legacy TEST deployment. Keep working until the separate product target is verified.
// New deployable code/resources use jiancheng_daka_ (see cloud-resources.js / cloud.product.js).
// Never silently redirect the old test account/queue to a different collection. No secrets here.
module.exports = { enabled: true, envId: 'cloud1-d4gq76oyt363f08a7', functionName: 'habitApi' };
