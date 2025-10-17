import React from 'react';
import { createRoot } from 'react-dom/client';

import 'font-awesome/css/font-awesome.min.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'nprogress/nprogress.css';

import './global.css';
import Browser from './browser';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<Browser/>);