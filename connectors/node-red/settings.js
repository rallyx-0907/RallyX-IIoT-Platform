module.exports = {
  uiPort: 1880,
  flowFile: process.env.FLOW_FILE || '/opt/rallyx/simulator.json',
  credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET,
  // Disable the editor/admin API on production containers.
  httpAdminRoot: false,
  httpNodeRoot: '/',
  functionGlobalContext: {},
  contextStorage: { default: { module: 'localfilesystem' } },
  logging: { console: { level: 'info', metrics: false, audit: false } },
};
