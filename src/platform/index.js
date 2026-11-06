/* The platform the app was built for (`--env platform=<name>`, default tizen): see contract.js. */
import adapter from '@platform';
import { withDefaults } from './contract.js';
import { createHtml5Engine } from '../services/playerEngines.js';

export const platform = withDefaults(adapter, { createDefaultEngine: createHtml5Engine });
