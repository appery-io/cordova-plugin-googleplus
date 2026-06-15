#!/usr/bin/env node
'use strict';

const fs = require('fs');
const plist = require('plist');
const q = require('q');
const utilities = require('./lib/utilities');
const path = require('path');

function log(message) {
  console.log('[cordova-plugin-googleplus][ios] ' + message);
}

function parsePlistSafe(filePath) {
  try {
    return plist.parse(fs.readFileSync(filePath, 'utf8')) || {};
  } catch (error) {
    log('Failed to parse plist at ' + filePath + ': ' + error.message + '. Will recreate file.');
    return {};
  }
}

function buildMinimalPlistXml(clientId, reversedClientId) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0">\n' +
      '<dict>\n' +
      '    <key>CLIENT_ID</key>\n' +
      '    <string>' + clientId + '</string>\n' +
      '    <key>REVERSED_CLIENT_ID</key>\n' +
      '    <string>' + reversedClientId + '</string>\n' +
      '</dict> \n' +
      '</plist>\n';
}

function updateClientKeys(existingData, clientId, reversedClientId) {
  const result = Object.assign({}, existingData);
  const hadClientId = Object.prototype.hasOwnProperty.call(result, 'CLIENT_ID');
  const hadReversedClientId = Object.prototype.hasOwnProperty.call(result, 'REVERSED_CLIENT_ID');
  const changedClientId = result.CLIENT_ID !== clientId;
  const changedReversedClientId = result.REVERSED_CLIENT_ID !== reversedClientId;

  result.CLIENT_ID = clientId;
  result.REVERSED_CLIENT_ID = reversedClientId;

  return {
    data: result,
    hadClientId: hadClientId,
    hadReversedClientId: hadReversedClientId,
    changedClientId: changedClientId,
    changedReversedClientId: changedReversedClientId
  };
}

function getGoogleServiceInfoSourcePaths(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'src', 'assets', 'files', 'GoogleService-Info.plist'),
    path.join(projectRoot, 'resources', 'GoogleService-Info.plist'),
    path.join(projectRoot, 'GoogleService-Info.plist')
  ];

  const configPath = path.join(projectRoot, 'config.xml');
  if (fs.existsSync(configPath)) {
    const xml = fs.readFileSync(configPath, 'utf8');
    const resourceFileRegex = /<resource-file\b([^>]*)\/?>/gi;
    let match;

    while ((match = resourceFileRegex.exec(xml)) !== null) {
      const attrs = match[1];
      const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
      const targetMatch = attrs.match(/\btarget=["']([^"']+)["']/i);

      if (!srcMatch || !targetMatch || !targetMatch[1].includes('GoogleService-Info.plist')) {
        continue;
      }

      candidates.unshift(path.resolve(projectRoot, srcMatch[1]));
    }
  }

  return [...new Set(candidates)];
}

function loadBestGoogleServiceInfoData(projectRoot) {
  const candidates = getGoogleServiceInfoSourcePaths(projectRoot);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const data = parsePlistSafe(candidate);
    if (Object.prototype.hasOwnProperty.call(data, 'GOOGLE_APP_ID')) {
      log('Using full Firebase plist as source: ' + candidate);
      return data;
    }

    if (Object.keys(data).length > 0) {
      log('Using existing plist as source: ' + candidate);
      return data;
    }
  }

  return null;
}

function ensureUrlSchemeEntry(appInfoPlist, reversedClientId) {
  const urlTypeName = 'REVERSED_CLIENT_ID';
  const urlTypes = Array.isArray(appInfoPlist.CFBundleURLTypes) ? appInfoPlist.CFBundleURLTypes : [];
  let targetEntry = null;

  for (let i = 0; i < urlTypes.length; i += 1) {
    if (urlTypes[i] && urlTypes[i].CFBundleURLName === urlTypeName) {
      targetEntry = urlTypes[i];
      break;
    }
  }

  if (!targetEntry) {
    targetEntry = {
      CFBundleTypeRole: 'Editor',
      CFBundleURLName: urlTypeName,
      CFBundleURLSchemes: []
    };
    urlTypes.push(targetEntry);
  }

  targetEntry.CFBundleURLSchemes = [reversedClientId];
  appInfoPlist.CFBundleURLTypes = urlTypes;
}

module.exports = function(context) {
  const deferral = q.defer();
  const projectRoot = context.opts.projectRoot;
  const resourcesPlistPath = path.join(projectRoot, 'resources', 'GoogleService-Info.plist');
  const appInfoPlistPath = utilities.getPlistPath(context);
  const iosProjectResourcesPath = path.join(path.dirname(appInfoPlistPath), 'Resources', 'GoogleService-Info.plist');
  const iosRootPlistPath = path.join(projectRoot, 'platforms', 'ios', 'GoogleService-Info.plist');
  const configuredClientId = utilities.getPreferenceValue('CLIENT_ID');
  const configuredReversedClientId = utilities.getPreferenceValue('REVERSED_CLIENT_ID');
  const resolvedIds = utilities.resolveClientIds(configuredClientId, configuredReversedClientId);

  log('Starting after_prepare hook.');

  if (resolvedIds.error) {
    deferral.reject(resolvedIds.error);
    return deferral.promise;
  }

  const clientId = resolvedIds.clientId;
  const reversedClientId = resolvedIds.reversedClientId;

  log(configuredClientId ? 'CLIENT_ID received from plugin variables.' : 'CLIENT_ID generated from REVERSED_CLIENT_ID.');
  log(configuredReversedClientId ? 'REVERSED_CLIENT_ID received from plugin variables.' : 'REVERSED_CLIENT_ID generated from CLIENT_ID.');

  try {
    let updatedPlistData;
    const existingPlistData = loadBestGoogleServiceInfoData(projectRoot) || parsePlistSafe(resourcesPlistPath);
    const updateResult = updateClientKeys(existingPlistData, clientId, reversedClientId);
    updatedPlistData = updateResult.data;

    if (!updateResult.hadClientId) {
      log('CLIENT_ID key is missing, adding it.');
    } else if (updateResult.changedClientId) {
      log('CLIENT_ID key exists, rewriting with new value.');
    } else {
      log('CLIENT_ID key is already up to date.');
    }

    if (!updateResult.hadReversedClientId) {
      log('REVERSED_CLIENT_ID key is missing, adding it.');
    } else if (updateResult.changedReversedClientId) {
      log('REVERSED_CLIENT_ID key exists, rewriting with new value.');
    } else {
      log('REVERSED_CLIENT_ID key is already up to date.');
    }

    if (!Object.prototype.hasOwnProperty.call(updatedPlistData, 'GOOGLE_APP_ID')) {
      log('Warning: GOOGLE_APP_ID is missing. Firebase plugins require a full GoogleService-Info.plist from Firebase Console.');
    }

    fs.mkdirSync(path.dirname(resourcesPlistPath), { recursive: true });
    fs.writeFileSync(resourcesPlistPath, plist.build(updatedPlistData), 'utf8');
    log('Updated resources plist: ' + resourcesPlistPath);

    fs.mkdirSync(path.dirname(iosProjectResourcesPath), { recursive: true });
    fs.writeFileSync(iosProjectResourcesPath, plist.build(updatedPlistData), 'utf8');
    log('Synced plist to iOS Resources: ' + iosProjectResourcesPath);

    fs.mkdirSync(path.dirname(iosRootPlistPath), { recursive: true });
    fs.writeFileSync(iosRootPlistPath, plist.build(updatedPlistData), 'utf8');
    log('Synced plist to iOS root: ' + iosRootPlistPath);
  } catch (error) {
    deferral.reject('Failed to create/update GoogleService-Info.plist: ' + error.message);
    return deferral.promise;
  }

  if (!fs.existsSync(appInfoPlistPath)) {
    deferral.reject('Info.plist not found at: ' + appInfoPlistPath);
    return deferral.promise;
  }

  try {
    log('Updating iOS Info.plist GIDClientID and URL scheme...');
    const appInfoPlist = plist.parse(fs.readFileSync(appInfoPlistPath, 'utf8'));
    appInfoPlist.GIDClientID = clientId;
    ensureUrlSchemeEntry(appInfoPlist, reversedClientId);
    fs.writeFileSync(appInfoPlistPath, plist.build(appInfoPlist), 'utf8');
    log('Successfully updated Info.plist with GIDClientID and REVERSED_CLIENT_ID URL scheme.');
  } catch (error) {
    deferral.reject('Failed to update Info.plist: ' + error.message);
    return deferral.promise;
  }

  log('after_prepare hook completed successfully.');
  deferral.resolve();
  return deferral.promise;
};
