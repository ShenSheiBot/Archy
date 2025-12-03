#import <Cocoa/Cocoa.h>
#import <node_api.h>

// Store the previously active app's PID (like iTerm2's iTermPreviousState)
static pid_t previouslyActiveAppPID = 0;

// Track the last non-Archy app that was active (updated via NSWorkspace notifications)
static pid_t lastActiveOtherAppPID = 0;
static id appActivationObserver = nil;

// Log all standard window levels for diagnostic purposes
void LogWindowLevels() {
  NSLog(@"[window-native] Window Level Map:");
  NSLog(@"  normal       = %d", CGWindowLevelForKey(kCGNormalWindowLevelKey));
  NSLog(@"  floating     = %d", CGWindowLevelForKey(kCGFloatingWindowLevelKey));
  NSLog(@"  popup        = %d", CGWindowLevelForKey(kCGPopUpMenuWindowLevelKey));
  NSLog(@"  status       = %d", CGWindowLevelForKey(kCGStatusWindowLevelKey));
  NSLog(@"  modalPanel   = %d", CGWindowLevelForKey(kCGModalPanelWindowLevelKey));
  NSLog(@"  screenSaver  = %d", CGWindowLevelForKey(kCGScreenSaverWindowLevelKey));
  NSLog(@"  assistive    = %d", CGWindowLevelForKey(kCGAssistiveTechHighWindowLevelKey));
  NSLog(@"  maximum      = %d", CGWindowLevelForKey(kCGMaximumWindowLevelKey));
}

// Get the main NSWindow from NSApplication
// This is more reliable than using getNativeWindowHandle
NSWindow* GetMainWindow() {
  NSArray<NSWindow*>* windows = [[NSApplication sharedApplication] windows];

  for (NSWindow* window in windows) {
    // Find the main browser window (not dev tools, etc.)
    if (window.isVisible && ![window.title containsString:@"Developer Tools"]) {
      return window;
    }
  }

  // Fallback to key window
  return [[NSApplication sharedApplication] keyWindow];
}

// Alternative: Get window from handle buffer (kept for compatibility)
NSWindow* GetNSWindowFromHandle(void* buffer_data, size_t buffer_length) {
  if (!buffer_data || buffer_length < sizeof(void*)) {
    NSLog(@"[window-native] Invalid buffer: data=%p, length=%zu", buffer_data, buffer_length);
    return nil;
  }

  // Read the pointer value from buffer
  void** ptr_ptr = (void**)buffer_data;
  void* view_ptr = *ptr_ptr;

  if (!view_ptr) {
    NSLog(@"[window-native] Null view pointer in buffer");
    return nil;
  }

  @try {
    NSView* view = (__bridge NSView*)view_ptr;
    NSWindow* window = [view window];

    if (!window) {
      NSLog(@"[window-native] Failed to get window from view: %p", view_ptr);
    }

    return window;
  } @catch (NSException* exception) {
    NSLog(@"[window-native] Exception getting window: %@", exception);
    return nil;
  }
}

// Set window level (floating, screen-saver, etc.)
napi_value SetWindowLevel(napi_env env, napi_callback_info info) {
  // Log window levels once for diagnostic
  static bool logged = false;
  if (!logged) {
    LogWindowLevels();
    logged = true;
  }

  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  NSWindow* window = nullptr;
  int level_arg_index = 0;

  if (argc == 1) {
    // Single argument: just level string, auto-find window
    window = GetMainWindow();
    level_arg_index = 0;
  } else if (argc >= 2) {
    // Two arguments: handle buffer + level string
    void* handle_buffer;
    size_t handle_length;
    napi_get_buffer_info(env, args[0], &handle_buffer, &handle_length);
    window = GetNSWindowFromHandle(handle_buffer, handle_length);

    if (!window) {
      // Fallback to auto-find if handle is invalid
      NSLog(@"[window-native] Invalid handle, falling back to auto-find window");
      window = GetMainWindow();
    }
    level_arg_index = 1;
  } else {
    napi_throw_error(env, nullptr, "Expected 1 or 2 arguments: [handle], level");
    return nullptr;
  }

  if (!window) {
    napi_throw_error(env, nullptr, "Could not find window");
    return nullptr;
  }

  // Get level string
  size_t str_size;
  napi_get_value_string_utf8(env, args[level_arg_index], nullptr, 0, &str_size);
  char* level_str = new char[str_size + 1];
  napi_get_value_string_utf8(env, args[level_arg_index], level_str, str_size + 1, &str_size);

  // Map level string to NSWindowLevel using dynamic CGWindowLevelForKey
  NSWindowLevel level;
  if (strcmp(level_str, "normal") == 0) {
    level = CGWindowLevelForKey(kCGNormalWindowLevelKey);
  } else if (strcmp(level_str, "floating") == 0) {
    level = CGWindowLevelForKey(kCGFloatingWindowLevelKey);
  } else if (strcmp(level_str, "popup") == 0) {
    level = CGWindowLevelForKey(kCGPopUpMenuWindowLevelKey);
  } else if (strcmp(level_str, "status") == 0) {
    level = CGWindowLevelForKey(kCGStatusWindowLevelKey);
  } else if (strcmp(level_str, "main-menu") == 0) {
    level = CGWindowLevelForKey(kCGMainMenuWindowLevelKey); // Level 24
  } else if (strcmp(level_str, "iterm") == 0) {
    // Level 22: same as iTerm2 floating hotkey window (NSMainMenuWindowLevel - 2)
    // Below notifications (23) but above normal windows, won't block Spotlight
    level = CGWindowLevelForKey(kCGMainMenuWindowLevelKey) - 2;
  } else if (strcmp(level_str, "screen-saver") == 0) {
    level = CGWindowLevelForKey(kCGScreenSaverWindowLevelKey) + 1; // +1 to ensure above everything
  } else if (strcmp(level_str, "assistive") == 0) {
    level = CGWindowLevelForKey(kCGAssistiveTechHighWindowLevelKey); // Use with caution
  } else {
    level = CGWindowLevelForKey(kCGScreenSaverWindowLevelKey) + 1; // Default to screen-saver
  }

  delete[] level_str;

  // Set window level on main thread
  dispatch_async(dispatch_get_main_queue(), ^{
    [window setLevel:level];
    NSLog(@"[window-native] ✓ Window level set to %d", (int)level);
  });

  return nullptr;
}

// Set collection behavior (canJoinAllSpaces, fullScreenAuxiliary, etc.)
napi_value SetCollectionBehavior(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  NSWindow* window = nullptr;
  int behaviors_arg_index = 0;

  if (argc == 1) {
    // Single argument: just behaviors array, auto-find window
    window = GetMainWindow();
    behaviors_arg_index = 0;
  } else if (argc >= 2) {
    // Two arguments: handle buffer + behaviors array
    void* handle_buffer;
    size_t handle_length;
    napi_get_buffer_info(env, args[0], &handle_buffer, &handle_length);
    window = GetNSWindowFromHandle(handle_buffer, handle_length);

    if (!window) {
      // Fallback to auto-find if handle is invalid
      NSLog(@"[window-native] Invalid handle, falling back to auto-find window");
      window = GetMainWindow();
    }
    behaviors_arg_index = 1;
  } else {
    napi_throw_error(env, nullptr, "Expected 1 or 2 arguments: [handle], behaviors");
    return nullptr;
  }

  if (!window) {
    napi_throw_error(env, nullptr, "Could not find window");
    return nullptr;
  }

  // Get behaviors array
  bool is_array;
  napi_is_array(env, args[behaviors_arg_index], &is_array);
  if (!is_array) {
    napi_throw_error(env, nullptr, "Behaviors argument must be an array");
    return nullptr;
  }

  uint32_t length;
  napi_get_array_length(env, args[behaviors_arg_index], &length);

  NSWindowCollectionBehavior behavior = 0;

  for (uint32_t i = 0; i < length; i++) {
    napi_value element;
    napi_get_element(env, args[behaviors_arg_index], i, &element);

    size_t str_size;
    napi_get_value_string_utf8(env, element, nullptr, 0, &str_size);
    char* behavior_str = new char[str_size + 1];
    napi_get_value_string_utf8(env, element, behavior_str, str_size + 1, &str_size);

    if (strcmp(behavior_str, "canJoinAllSpaces") == 0) {
      behavior |= NSWindowCollectionBehaviorCanJoinAllSpaces;
    } else if (strcmp(behavior_str, "fullScreenAuxiliary") == 0) {
      behavior |= NSWindowCollectionBehaviorFullScreenAuxiliary;
    } else if (strcmp(behavior_str, "stationary") == 0) {
      behavior |= NSWindowCollectionBehaviorStationary;
    } else if (strcmp(behavior_str, "ignoresCycle") == 0) {
      behavior |= NSWindowCollectionBehaviorIgnoresCycle;
    }

    delete[] behavior_str;
  }

  // Set collection behavior on main thread
  dispatch_async(dispatch_get_main_queue(), ^{
    [window setCollectionBehavior:behavior];
    NSLog(@"[window-native] ✓ Collection behavior set (0x%lx)", (unsigned long)behavior);
  });

  return nullptr;
}

// Start tracking app activations via NSWorkspace notifications
// This allows us to know the last active app even if hotkey activates us first
napi_value StartAppTracking(napi_env env, napi_callback_info info) {
  if (appActivationObserver) {
    NSLog(@"[window-native] App tracking already started");
    napi_value result;
    napi_get_boolean(env, true, &result);
    return result;
  }

  NSRunningApplication* currentApp = [NSRunningApplication currentApplication];
  pid_t ourPID = currentApp.processIdentifier;

  appActivationObserver = [[NSWorkspace sharedWorkspace].notificationCenter
      addObserverForName:NSWorkspaceDidActivateApplicationNotification
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(NSNotification* note) {
                NSRunningApplication* app = note.userInfo[NSWorkspaceApplicationKey];
                if (app && app.processIdentifier != ourPID) {
                  lastActiveOtherAppPID = app.processIdentifier;
                  NSLog(@"[window-native] Tracked app activation: %@ (PID: %d)",
                        app.localizedName, lastActiveOtherAppPID);
                }
              }];

  NSLog(@"[window-native] ✓ Started app activation tracking");

  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

// Save the currently frontmost app's PID (call BEFORE activating our app)
// Now uses tracked lastActiveOtherAppPID as fallback when we're already frontmost
napi_value SavePreviousApp(napi_env env, napi_callback_info info) {
  NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
  NSRunningApplication* currentApp = [NSRunningApplication currentApplication];

  if (frontApp && ![frontApp isEqual:currentApp]) {
    // Another app is frontmost - save it
    previouslyActiveAppPID = frontApp.processIdentifier;
    NSLog(@"[window-native] ✓ Saved previous app: %@ (PID: %d)",
          frontApp.localizedName, previouslyActiveAppPID);
  } else if (lastActiveOtherAppPID != 0) {
    // We are frontmost, but we have a tracked app from notifications - use it
    NSRunningApplication* trackedApp = [NSRunningApplication
        runningApplicationWithProcessIdentifier:lastActiveOtherAppPID];
    if (trackedApp) {
      previouslyActiveAppPID = lastActiveOtherAppPID;
      NSLog(@"[window-native] ✓ Using tracked app: %@ (PID: %d)",
            trackedApp.localizedName, previouslyActiveAppPID);
    } else {
      lastActiveOtherAppPID = 0;
      NSLog(@"[window-native] Tracked app no longer exists, cleared");
    }
  } else if (previouslyActiveAppPID != 0) {
    // Keep existing saved app (like iTerm2)
    NSRunningApplication* savedApp = [NSRunningApplication
        runningApplicationWithProcessIdentifier:previouslyActiveAppPID];
    if (savedApp) {
      NSLog(@"[window-native] Keeping previously saved app: %@ (PID: %d)",
            savedApp.localizedName, previouslyActiveAppPID);
    } else {
      previouslyActiveAppPID = 0;
      NSLog(@"[window-native] Previously saved app no longer exists, cleared");
    }
  } else {
    NSLog(@"[window-native] No previous app to save (we are frontmost with no saved app)");
  }

  napi_value result;
  napi_create_int32(env, previouslyActiveAppPID, &result);
  return result;
}

// Restore focus to the previously active app (call when hiding our window)
napi_value RestorePreviousApp(napi_env env, napi_callback_info info) {
  if (previouslyActiveAppPID == 0) {
    NSLog(@"[window-native] RestorePreviousApp: No previous app saved");
    napi_value result;
    napi_get_boolean(env, false, &result);
    return result;
  }

  NSRunningApplication* app = [NSRunningApplication
      runningApplicationWithProcessIdentifier:previouslyActiveAppPID];

  if (!app) {
    NSLog(@"[window-native] RestorePreviousApp: App with PID %d no longer exists",
          previouslyActiveAppPID);
    previouslyActiveAppPID = 0;
    napi_value result;
    napi_get_boolean(env, false, &result);
    return result;
  }

  NSLog(@"[window-native] Restoring previous app: %@ (PID: %d)",
        app.localizedName, previouslyActiveAppPID);

  // Activate the previous app (like iTerm2's restorePreviouslyActiveApp)
  BOOL success = [app activateWithOptions:0];

  NSLog(@"[window-native] ✓ activateWithOptions:0 returned %@", success ? @"YES" : @"NO");

  previouslyActiveAppPID = 0;  // Clear after restoring

  napi_value result;
  napi_get_boolean(env, success, &result);
  return result;
}

// Order out window (hide without deactivating app, like NSPanel.orderOut)
napi_value OrderOut(napi_env env, napi_callback_info info) {
  NSWindow* window = GetMainWindow();

  if (!window) {
    NSLog(@"[window-native] OrderOut: No window found");
    return nullptr;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    [window orderOut:nil];
    NSLog(@"[window-native] ✓ orderOut called");
  });

  return nullptr;
}

// Simulate a mouse click on the window to force focus transfer
// This uses CGEvent to create a synthetic click, which macOS handles naturally
// The mouse cursor is saved and restored to avoid visible movement
napi_value SimulateClick(napi_env env, napi_callback_info info) {
  NSWindow* window = GetMainWindow();

  if (!window) {
    NSLog(@"[window-native] SimulateClick: No window found");
    return nullptr;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    // Save current mouse position
    CGEventRef getPos = CGEventCreate(NULL);
    CGPoint originalPos = CGEventGetLocation(getPos);
    CFRelease(getPos);

    // Get window frame and calculate click position
    // Click at the very top-left corner of the window (safe area with no UI)
    NSRect frame = [window frame];
    CGFloat clickX = frame.origin.x + 5;  // 5px from left edge
    // macOS screen coordinates: origin at bottom-left, CGEvent uses top-left
    // Click 5 pixels below the top of the window
    CGFloat screenHeight = [[NSScreen mainScreen] frame].size.height;
    CGFloat clickY = screenHeight - (frame.origin.y + frame.size.height - 5);

    CGPoint clickPoint = CGPointMake(clickX, clickY);

    NSLog(@"[window-native] SimulateClick at (%.0f, %.0f), will restore to (%.0f, %.0f)",
          clickX, clickY, originalPos.x, originalPos.y);

    // Create mouse down event
    CGEventRef mouseDown = CGEventCreateMouseEvent(
      NULL,
      kCGEventLeftMouseDown,
      clickPoint,
      kCGMouseButtonLeft
    );

    // Create mouse up event
    CGEventRef mouseUp = CGEventCreateMouseEvent(
      NULL,
      kCGEventLeftMouseUp,
      clickPoint,
      kCGMouseButtonLeft
    );

    // Clear all modifier flags to prevent Control+Click = Right Click
    if (mouseDown) CGEventSetFlags(mouseDown, (CGEventFlags)0);
    if (mouseUp) CGEventSetFlags(mouseUp, (CGEventFlags)0);

    if (mouseDown && mouseUp) {
      // Post the events
      CGEventPost(kCGHIDEventTap, mouseDown);
      CGEventPost(kCGHIDEventTap, mouseUp);

      // Restore mouse position immediately
      CGWarpMouseCursorPosition(originalPos);
      // Suppress the "mouse moved" event that CGWarpMouseCursorPosition generates
      CGAssociateMouseAndMouseCursorPosition(true);

      NSLog(@"[window-native] ✓ SimulateClick posted, cursor restored");
    } else {
      NSLog(@"[window-native] ✗ SimulateClick failed to create events");
    }

    // Clean up
    if (mouseDown) CFRelease(mouseDown);
    if (mouseUp) CFRelease(mouseUp);
  });

  return nullptr;
}

// Module initialization
napi_value Init(napi_env env, napi_value exports) {
  napi_value set_level_fn, set_behavior_fn, order_out_fn;
  napi_value save_prev_fn, restore_prev_fn, simulate_click_fn;
  napi_value start_tracking_fn;

  napi_create_function(env, nullptr, 0, SetWindowLevel, nullptr, &set_level_fn);
  napi_create_function(env, nullptr, 0, SetCollectionBehavior, nullptr, &set_behavior_fn);
  napi_create_function(env, nullptr, 0, OrderOut, nullptr, &order_out_fn);
  napi_create_function(env, nullptr, 0, StartAppTracking, nullptr, &start_tracking_fn);
  napi_create_function(env, nullptr, 0, SavePreviousApp, nullptr, &save_prev_fn);
  napi_create_function(env, nullptr, 0, RestorePreviousApp, nullptr, &restore_prev_fn);
  napi_create_function(env, nullptr, 0, SimulateClick, nullptr, &simulate_click_fn);

  napi_set_named_property(env, exports, "setWindowLevel", set_level_fn);
  napi_set_named_property(env, exports, "setCollectionBehavior", set_behavior_fn);
  napi_set_named_property(env, exports, "orderOut", order_out_fn);
  napi_set_named_property(env, exports, "startAppTracking", start_tracking_fn);
  napi_set_named_property(env, exports, "savePreviousApp", save_prev_fn);
  napi_set_named_property(env, exports, "restorePreviousApp", restore_prev_fn);
  napi_set_named_property(env, exports, "simulateClick", simulate_click_fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
