const fs = require('fs');
const Utilities = {};

Utilities.getPreferenceValueFromConfig = function (config, name) {
  const value = config.match(new RegExp('name="' + name + '" value="(.*?)"', "i"))
  if (value && value[1]) {
    return value[1]
  } else {
    return null
  }
}

Utilities.getPreferenceValueFromPackageJson = function (packageJson, name) {
  const value = packageJson.match(new RegExp('"' + name + '":\\s"(.*?)"', "i"));
  if (value && value[1]) {
    return value[1]
  } else {
    return null
  }
}

Utilities.getPreferenceValue = function (name) {
  const config = fs.readFileSync("config.xml").toString();
  let preferenceValue = Utilities.getPreferenceValueFromConfig(config, name);
  if (!preferenceValue) {
    const packageJson = fs.readFileSync("package.json").toString();
    preferenceValue = Utilities.getPreferenceValueFromPackageJson(packageJson, name)
  }
  return preferenceValue
}

Utilities.getPlistPath = function (context) {
  const common = context.requireCordovaModule('cordova-common');
  const util = context.requireCordovaModule('cordova-lib/src/cordova/util');
  const projectName = new common.ConfigParser(util.projectConfig(util.isCordova())).name();
  return './platforms/ios/' + projectName + '/' + projectName + '-Info.plist'
}

Utilities.deriveReversedClientId = function (clientId) {
  if (!clientId) {
    return null;
  }

  const suffix = '.apps.googleusercontent.com';
  if (!clientId.endsWith(suffix)) {
    return null;
  }

  const prefix = clientId.slice(0, -suffix.length);
  return 'com.googleusercontent.apps.' + prefix;
}

Utilities.deriveClientId = function (reversedClientId) {
  if (!reversedClientId) {
    return null;
  }

  const prefix = 'com.googleusercontent.apps.';
  if (!reversedClientId.startsWith(prefix)) {
    return null;
  }

  const value = reversedClientId.slice(prefix.length);
  return value ? value + '.apps.googleusercontent.com' : null;
}

Utilities.resolveClientIds = function (clientId, reversedClientId) {
  let resolvedClientId = clientId || null;
  let resolvedReversedClientId = reversedClientId || null;

  if (!resolvedClientId && !resolvedReversedClientId) {
    return {
      error: 'One of CLIENT_ID or REVERSED_CLIENT_ID plugin variables must be provided.'
    };
  }

  if (!resolvedClientId) {
    resolvedClientId = Utilities.deriveClientId(resolvedReversedClientId);
    if (!resolvedClientId) {
      return {
        error: 'Unable to derive CLIENT_ID from REVERSED_CLIENT_ID. Expected format: com.googleusercontent.apps.<id>.'
      };
    }
  }

  if (!resolvedReversedClientId) {
    resolvedReversedClientId = Utilities.deriveReversedClientId(resolvedClientId);
    if (!resolvedReversedClientId) {
      return {
        error: 'Unable to derive REVERSED_CLIENT_ID from CLIENT_ID. Expected format: <id>.apps.googleusercontent.com.'
      };
    }
  }

  return {
    clientId: resolvedClientId,
    reversedClientId: resolvedReversedClientId
  };
}

module.exports = Utilities;
