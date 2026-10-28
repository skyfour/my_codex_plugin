import config from './playwright.regression.config';
export default {...config,testMatch:['ui.spec.ts','ui-regression.spec.ts','ui-tree.spec.ts','ui-audit.spec.ts','workspace-transfer.spec.ts','backup-ui.spec.ts']};
