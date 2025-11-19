import React from 'react';
import { createRoot } from 'react-dom/client';

import 'font-awesome/css/font-awesome.min.css';
import 'bootstrap/dist/css/bootstrap.min.css';

import '../global.css';
import './navbar.css';
import NavBarApp from './NavBarApp';

const container = document.getElementById('navbar-root');
const root = createRoot(container);
root.render(<NavBarApp />);
