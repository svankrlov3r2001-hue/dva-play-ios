const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

function patchExpoRootViewController(projectRoot) {
  const filePath = path.join(
    projectRoot,
    'node_modules',
    'expo-modules-core',
    'ios',
    'ReactDelegates',
    'ExpoRootViewController.swift'
  );
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('prefersHomeIndicatorAutoHidden')) {
    return false;
  }

  const target = '  open override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {\n    return RCTStatusBarAppearance.updateAnimation\n  }';
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.includes(target)) {
    throw new Error(`Could not find insertion point in ${filePath}`);
  }

  const replacement = `${target}

  open override var prefersHomeIndicatorAutoHidden: Bool {
    return RCTStatusBarAppearance.hidden || view.bounds.width > view.bounds.height
  }

  open override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    setNeedsUpdateOfHomeIndicatorAutoHidden()
  }`;

  const updated = normalized.replace(target, replacement);
  fs.writeFileSync(filePath, updated, 'utf8');
  return true;
}

function patchScreenOrientationViewController(projectRoot) {
  const filePath = path.join(
    projectRoot,
    'node_modules',
    'expo-screen-orientation',
    'ios',
    'ScreenOrientationViewController.swift'
  );
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('prefersHomeIndicatorAutoHidden')) {
    return false;
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const orientationTarget = '    let mask = screenOrientationRegistry.requiredOrientationMask()\n    return !mask.isEmpty ? mask : defaultOrientationMask\n  }';
  if (!normalized.includes(orientationTarget)) {
    throw new Error(`Could not find supportedInterfaceOrientations end in ${filePath}`);
  }

  const orientationReplacement = `${orientationTarget}

#if os(iOS)
  override var prefersHomeIndicatorAutoHidden: Bool {
    return prefersStatusBarHidden || view.bounds.width > view.bounds.height
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    setNeedsUpdateOfHomeIndicatorAutoHidden()
  }
#endif`;

  let updated = normalized.replace(orientationTarget, orientationReplacement);

  const transitionTarget = '      self.previousInterfaceOrientation = windowInterfaceOrientation\n    }';
  if (updated.includes(transitionTarget)) {
    updated = updated.replace(
      transitionTarget,
      `      self.previousInterfaceOrientation = windowInterfaceOrientation
#if os(iOS)
      self.setNeedsUpdateOfHomeIndicatorAutoHidden()
#endif
    }`
    );
  }

  fs.writeFileSync(filePath, updated, 'utf8');
  return true;
}

/**
 * Patches Expo iOS root view controllers so the iPhone bottom Home Indicator
 * auto-hides while the player is active or in landscape orientation.
 */
function patchNodeModules(projectRoot) {
  const rootChanged = patchExpoRootViewController(projectRoot);
  const orientationChanged = patchScreenOrientationViewController(projectRoot);
  return { rootChanged, orientationChanged };
}

function withIosHomeIndicatorAutoHide(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      patchNodeModules(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);
}

withIosHomeIndicatorAutoHide.patchNodeModules = patchNodeModules;
module.exports = withIosHomeIndicatorAutoHide;
