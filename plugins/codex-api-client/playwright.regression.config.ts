import config from './playwright.config';
export default {...config,testMatch:['ui.spec.ts','ui-regression.spec.ts']};
