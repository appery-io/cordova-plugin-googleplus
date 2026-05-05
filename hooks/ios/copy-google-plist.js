const fs = require('fs');
const path = require('path');

module.exports = function (context) {
  const root = context.opts.projectRoot;

  const srcPath = path.join(root, 'src/assets/files/GoogleService-Info.plist');
  const destPath = path.join(root, 'platforms/ios', 'GoogleService-Info.plist');
  
  if (fs.existsSync(destPath)) {
    console.log('ℹ️  GoogleService-Info.plist exists');
    return;
  }

  if (fs.existsSync(srcPath)) {
    console.log('✔️  GoogleService-Info.plist copied');
    fs.copyFileSync(srcPath, destPath);
  } else {
    console.log('❌ GoogleService-Info.plist not found. Please upload into Project -> App Settings -> General -> press button Files and upload it ');
//    throw new Error('GoogleService-Info.plist not found. Please upload into Project -> App Settings -> General -> press button Files and upload it');
  }
};