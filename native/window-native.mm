#import <Cocoa/Cocoa.h>
#import <node_api.h>

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

// Module initialization
napi_value Init(napi_env env, napi_value exports) {
  napi_value set_level_fn, set_behavior_fn;

  napi_create_function(env, nullptr, 0, SetWindowLevel, nullptr, &set_level_fn);
  napi_create_function(env, nullptr, 0, SetCollectionBehavior, nullptr, &set_behavior_fn);

  napi_set_named_property(env, exports, "setWindowLevel", set_level_fn);
  napi_set_named_property(env, exports, "setCollectionBehavior", set_behavior_fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
