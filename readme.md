<div align="center">
  <img src="public/img/background-less.png" height="148" />
  <h2 align="center">Archy</h2>
  <p align="center">Cross-platform floating window browser</p>
  <p align="center">
    <a href="https://github.com/ShenSheiBot/archy/blob/master/license">
      <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="license">
    </a>
  </p>
</div>

---

Archy opens any website or media in a **small floating window that remains on top of all other applications**. The window stays up **all the time**, keeping important content visible while you work on other tasks. Perfect for **easy multitasking**.

**Inspired by [Archytas's pigeon](https://en.wikipedia.org/wiki/Archytas#The_flying_dove)** – the world's first self-propelled flying automaton, created around 400 BC.

---

## Features

* Always **stays on top** of any open applications
* **Customizable opacity** – gets out of your way while you work
* **Multi-tab support** with keyboard shortcuts
* **Per-domain zoom control** – persistent zoom levels (50%-300%)
* **In-page search** with match navigation (Cmd+F)
* **Startup options** – blank page, restore session, or custom URL
* **Hide navbar mode** – minimal distraction
* **Menu bar icon** – no dock clutter
* **Detached mode** for click-through
* **Frameless window** option
* **Cross-platform** – macOS, Windows, Linux
* **Lean** – minimal resource footprint

## Installation

### macOS

```bash
# Build from source
git clone https://github.com/ShenSheiBot/archy.git
cd archy
npm install
npm run build
npm run electron:build
```

The built app will be in `dist/` directory.

## Usage

### Keyboard Shortcuts

**Window & Tabs**
* **Global Toggle**: <kbd>Ctrl+Alt+Shift+0</kbd> – Show/hide window from anywhere
* **New Tab**: <kbd>Cmd/Ctrl+T</kbd>
* **Close Tab**: <kbd>Cmd/Ctrl+W</kbd>
* **Next Tab**: <kbd>Ctrl+Tab</kbd>
* **Previous Tab**: <kbd>Ctrl+Shift+Tab</kbd>

**Navigation & View**
* **Focus URL**: <kbd>Cmd/Ctrl+L</kbd>
* **Refresh**: <kbd>Cmd/Ctrl+R</kbd>
* **Find in Page**: <kbd>Cmd/Ctrl+F</kbd>
* **Toggle Navbar**: <kbd>Cmd/Ctrl+Shift+L</kbd>

**Zoom**
* **Zoom In**: <kbd>Cmd/Ctrl++</kbd>
* **Zoom Out**: <kbd>Cmd/Ctrl+-</kbd>
* **Reset Zoom**: <kbd>Cmd/Ctrl+0</kbd>

**Modes**
* **Detached Mode**: <kbd>Cmd/Ctrl+Shift+D</kbd> – Makes window non-interactive (click-through)
* **Frameless Window**: <kbd>Cmd/Ctrl+Shift+F</kbd> – Toggle window frame (requires restart)

### Menu Bar

* **Left-click**: Toggle window visibility
* **Right-click**: Open context menu

### Opacity Control

* **Menu**: View → Set Opacity (20%-100%)
* **Shortcuts**: <kbd>Cmd/Ctrl+Shift+Up/Down</kbd> – Increase/decrease by 10%
* **Slider**: Settings panel in navbar

### Startup Options

Configure how Archy starts (via Settings panel):
* **Blank Page** – Start with empty tab
* **Restore Session** – Restore previous tabs (default)
* **Custom URL** – Open specific URL on startup

## Use Cases

* **AI Assistants** – Keep ChatGPT, Claude, or other AI tools visible while working
* **Videos with Danmaku** – Watch Bilibili, Niconico, or other sites that don't support PiP
* **Coding tutorials** – Follow along while you code
* **Documentation** – Keep reference docs always visible
* **Video courses** – Watch demos without switching windows
* **Live streams** – Monitor streams while working
* **UI development** – See live output alongside code
* **Dashboards** – Keep monitoring tools in view
* **Multi-tasking** – Any content that needs to stay visible

## Why "Archy"?

Named after [**Archytas of Tarentum**](https://en.wikipedia.org/wiki/Archytas) (428–347 BC), a Greek mathematician, philosopher, and engineer who built the world's first self-propelled flying device – a wooden pigeon powered by steam or compressed air. Like his creation that stayed aloft above the ground, Archy keeps your windows floating above all other apps.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
npm run electron:dev

# Build for production
npm run build
npm run electron:build
```

## Advanced Features

### Detached Mode

When enabled (<kbd>Cmd/Ctrl+Shift+D</kbd>), the window becomes non-interactive and lets all clicks pass through to apps below it. Perfect for overlay displays.

To exit detached mode:
* Click the menu bar icon
* Focus the window to re-enable mouse events

### Video Embedding

For streaming sites (YouTube, Vimeo, Twitch, etc.), Archy can show video-only pages using auto-generated embed links. Toggle via: Edit → Embed Videos

**Note**: Some YouTube videos may not work with embedding enabled due to user restrictions. Disable "Embed Videos" if needed.

## Credits

Originally based on [Pennywise](https://github.com/kamranahmedse/pennywise) by Kamran Ahmed.
## License

MIT © [See License](license)

---

<p align="center">
  <i>Like Archytas's pigeon, Archy floats above it all</i>
</p>
