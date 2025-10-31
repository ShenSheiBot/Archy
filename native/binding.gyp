{
  "targets": [
    {
      "target_name": "window-native",
      "sources": [ "window-native.mm" ],
      "conditions": [
        ['OS=="mac"', {
          "xcode_settings": {
            "OTHER_CFLAGS": [
              "-ObjC++",
              "-std=c++14"
            ]
          },
          "link_settings": {
            "libraries": [
              "-framework Cocoa",
              "-framework AppKit"
            ]
          }
        }]
      ]
    }
  ]
}
