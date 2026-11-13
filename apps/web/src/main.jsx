import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import App from './App.jsx';
import './styles.css';
import './styles/mobile.css';
import './styles/polish.css';
import './styles/consistency.css';
import './styles/ticket-window.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
