// The Worker entry. workerd reads every named export of this module as a handler, so the API
// lives in api.ts and only the default export is here.
import { handle } from './api.js';

export default { fetch: handle };
