#!/usr/bin/env node
'use strict';

const fs = require('fs');
const plist = require('plist');
const q = require('q');
const utilities = require('./lib/utilities');
const path = require('path');

function parseExistingPlistIfAny(plistPath) {
  if (!fs.existsSync(plistPath)) {
    return {};
  }

  try {
    return plist.parse(fs.readFileSync(plistPath, 'utf8')) || {};
  } catch (error) {
    console.warn('Failed to parse existing plist at ' + plistPath + ': ' + error.message);
    return {};
  }
}

function mergeMissingKeys(existingData, requiredData) {
  const merged = Object.assign({}, existingData);
  const addedKeys = [];
  const existingKeys = [];
  Object.keys(requiredData).forEach(function(key) {
    const value = merged[key];
    if (value === undefined || value === null || value === '') {
      merged[key] = requiredData[key];
      addedKeys.push(key);
    } else {
      existingKeys.push(key);
    }
  });
  return {
    merged: merged,
    addedKeys: addedKeys,
    existingKeys: existingKeys
  };
}

function collectInstallProvidedValues() {
  const providedValues = {};
  const iosClientId = utilities.getPreferenceValue('IOS_CLIENT_ID');
  const fallbackClientId = utilities.getPreferenceValue('CLIENT_ID');
  const clientId = iosClientId || fallbackClientId;
  const reversedClientId = utilities.getPreferenceValue('REVERSED_CLIENT_ID');
  const iosBundleId = utilities.getPreferenceValue('IOS_BUNDLE_ID');
  const googleProjectId = utilities.getPreferenceValue('GOOGLE_PROJECT_ID');
  const googleStorageBucket = utilities.getPreferenceValue('GOOGLE_STORAGE_BUCKET');
  const iosGoogleAppId = utilities.getPreferenceValue('IOS_GOOGLE_APP_ID');

  if (clientId) {
    providedValues.CLIENT_ID = clientId;
  }
  if (reversedClientId) {
    providedValues.REVERSED_CLIENT_ID = reversedClientId;
  }
  if (iosBundleId) {
    providedValues.BUNDLE_ID = iosBundleId;
  }
  if (googleProjectId) {
    providedValues.PROJECT_ID = googleProjectId;
  }
  if (googleStorageBucket) {
    providedValues.STORAGE_BUCKET = googleStorageBucket;
  }
  if (iosGoogleAppId) {
    providedValues.GOOGLE_APP_ID = iosGoogleAppId;
  }

  return providedValues;
}

function overwriteKeysFromInstallVariables(targetData, installProvidedData) {
  const overwrittenKeys = [];
  const overlappingKeys = [];
  const merged = Object.assign({}, targetData);

  Object.keys(installProvidedData).forEach(function(key) {
    const installValue = installProvidedData[key];
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      overlappingKeys.push(key);
      if (merged[key] !== installValue) {
        overwrittenKeys.push(key);
      }
    }
    merged[key] = installValue;
  });

  return {
    merged: merged,
    overlappingKeys: overlappingKeys,
    overwrittenKeys: overwrittenKeys
  };
}

function validateClientId(clientId) {
  return /^[a-zA-Z0-9.-]+\.apps\.googleusercontent\.com$/.test(clientId);
}

function validateReversedClientId(reversedClientId) {
  return /^com\.googleusercontent\.apps\.[a-zA-Z0-9.-]+$/.test(reversedClientId);
}

function isStrictValidationEnabled() {
  const value = (utilities.getPreferenceValue('IOS_STRICT_VALIDATION') || 'false').toLowerCase();
  return value !== 'false';
}

module.exports = function(context) {
  const deferral = q.defer();

  const appInfoPlistPath = utilities.getPlistPath(context);
  const projectRoot = context.opts.projectRoot;
  const iosPlatformPath = path.join(projectRoot, 'platforms', 'ios');
  const iosProjectResourcesPath = path.join(path.dirname(appInfoPlistPath), 'Resources', 'GoogleService-Info.plist');
  const iosRootPlistPath = path.join(iosPlatformPath, 'GoogleService-Info.plist');

  const reversedClientId = utilities.getPreferenceValue('REVERSED_CLIENT_ID');
  const clientId = utilities.getPreferenceValue('IOS_CLIENT_ID') || utilities.getPreferenceValue('CLIENT_ID');
  const strictValidation = isStrictValidationEnabled();
  console.log('[cordova-plugin-googleplus] IOS_STRICT_VALIDATION=' + (strictValidation ? 'true' : 'false'));

  if (!clientId) {
    console.error('IOS_CLIENT_ID (or CLIENT_ID) plugin variable was not provided.');
    deferral.reject('IOS_CLIENT_ID (or CLIENT_ID) plugin variable was not provided.');
    return deferral.promise;
  }

  if (!reversedClientId) {
    console.error('REVERSED_CLIENT_ID plugin variable was not provided.');
    deferral.reject('REVERSED_CLIENT_ID plugin variable was not provided.');
    return deferral.promise;
  }

  if (!validateClientId(clientId)) {
    const message = 'IOS_CLIENT_ID has invalid format. Expected something like 123-abc.apps.googleusercontent.com';
    if (strictValidation) {
      console.error(message);
      deferral.reject(message);
      return deferral.promise;
    }
    console.warn('[cordova-plugin-googleplus] ' + message + ' Continuing because IOS_STRICT_VALIDATION=false.');
  }

  if (!validateReversedClientId(reversedClientId)) {
    const message = 'REVERSED_CLIENT_ID has invalid format. Expected something like com.googleusercontent.apps.123-abc';
    if (strictValidation) {
      console.error(message);
      deferral.reject(message);
      return deferral.promise;
    }
    console.warn('[cordova-plugin-googleplus] ' + message + ' Continuing because IOS_STRICT_VALIDATION=false.');
  }

  const googleServiceInfo = {
    CLIENT_ID: clientId,
    REVERSED_CLIENT_ID: reversedClientId,
    PLIST_VERSION: '1',
    BUNDLE_ID: utilities.getPreferenceValue('IOS_BUNDLE_ID') || '$(PRODUCT_BUNDLE_IDENTIFIER)',
    PROJECT_ID: utilities.getPreferenceValue('GOOGLE_PROJECT_ID') || '',
    STORAGE_BUCKET: utilities.getPreferenceValue('GOOGLE_STORAGE_BUCKET') || '',
    GOOGLE_APP_ID: utilities.getPreferenceValue('IOS_GOOGLE_APP_ID') || '',
    IS_SIGNIN_ENABLED: true
  };
  const installProvidedValues = collectInstallProvidedValues();

  try {
    const plistExistedBefore = fs.existsSync(iosProjectResourcesPath) || fs.existsSync(iosRootPlistPath);
    const sourcePlistPath = fs.existsSync(iosProjectResourcesPath) ? iosProjectResourcesPath : iosRootPlistPath;
    const existingPlist = fs.existsSync(iosProjectResourcesPath)
      ? parseExistingPlistIfAny(iosProjectResourcesPath)
      : parseExistingPlistIfAny(iosRootPlistPath);
    console.log('[cordova-plugin-googleplus] CLIENT_ID source: plugin variable');
    console.log('[cordova-plugin-googleplus] REVERSED_CLIENT_ID source: plugin variable');
    if (plistExistedBefore) {
      console.log('[cordova-plugin-googleplus] Existing plist source: ' + sourcePlistPath);
    } else {
      console.log('[cordova-plugin-googleplus] Existing plist source: not found, creating new plist');
    }
    const mergeResult = mergeMissingKeys(existingPlist, googleServiceInfo);
    const overwriteResult = overwriteKeysFromInstallVariables(mergeResult.merged, installProvidedValues);
    const mergedGoogleServiceInfo = overwriteResult.merged;
    console.log('[cordova-plugin-googleplus] Merge report: added=' +
      (mergeResult.addedKeys.length ? mergeResult.addedKeys.join(', ') : 'none') +
      '; existing=' +
      (mergeResult.existingKeys.length ? mergeResult.existingKeys.join(', ') : 'none'));
    if (overwriteResult.overlappingKeys.length) {
      console.log('[cordova-plugin-googleplus] Found overlapping install variables in existing GoogleService-Info.plist: ' +
        overwriteResult.overlappingKeys.join(', '));
      if (overwriteResult.overwrittenKeys.length) {
        console.log('[cordova-plugin-googleplus] Rewrote existing plist values from install variables: ' +
          overwriteResult.overwrittenKeys.join(', '));
      } else {
        console.log('[cordova-plugin-googleplus] Existing plist values already match install variables.');
      }
    }

    fs.mkdirSync(path.dirname(iosProjectResourcesPath), { recursive: true });
    fs.writeFileSync(iosProjectResourcesPath, plist.build(mergedGoogleServiceInfo), 'utf8');
    fs.writeFileSync(iosRootPlistPath, plist.build(mergedGoogleServiceInfo), 'utf8');
    if (plistExistedBefore) {
      console.log('GoogleService-Info.plist checked and merged with missing keys.');
    } else {
      console.log('GoogleService-Info.plist generated from plugin variables.');
    }
  } catch (error) {
    console.error('Failed to generate GoogleService-Info.plist: ' + error.message);
    deferral.reject('Failed to generate GoogleService-Info.plist: ' + error.message);
    return deferral.promise;
  }

  if (!fs.existsSync(appInfoPlistPath)) {
    console.error("Info.plist not found at: " + appInfoPlistPath);
    deferral.reject("Info.plist not found at: " + appInfoPlistPath);
    return deferral.promise;
  }

  // Step 4: Read and update Info.plist
  console.log("Updating Info.plist...");

  const appInfoPlist = plist.parse(fs.readFileSync(appInfoPlistPath, 'utf8'));

  // Add the CLIENT_ID to the GIDClientID key
  appInfoPlist.GIDClientID = clientId;

  // Step 5: Write the updated Info.plist back
  fs.writeFileSync(appInfoPlistPath, plist.build(appInfoPlist), 'utf8');

  console.log("Successfully updated Info.plist with GIDClientID.");

  deferral.resolve();
  return deferral.promise;
};
