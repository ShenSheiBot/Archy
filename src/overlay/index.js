import React from 'react';
import { createRoot } from 'react-dom/client';
import 'font-awesome/css/font-awesome.min.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../global.css';
import './overlay.css';
import OverlayApp from './OverlayApp';

const container = document.getElementById('overlay-root');
const root = createRoot(container);
root.render(<OverlayApp />);
