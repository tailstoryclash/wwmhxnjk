import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/rajdhani/400.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import './styles.css';
import { Game } from './game.js';

const game = new Game(document.getElementById('game'), document.getElementById('ui'));

// ?debug exposes the game object for inspection and automated checks.
if (new URLSearchParams(location.search).has('debug')) window.__game = game;

game.boot();
