import config from './playwright.regression.config';
export default {...config,testMatch:['ui.spec.ts','ui-regression.spec.ts','ui-tree.spec.ts','ui-audit.spec.ts','workspace-transfer.spec.ts','backup-ui.spec.ts','compatibility-ui.spec.ts','oauth-ui.spec.ts','protocol-ui.spec.ts','protocol-native-ui.spec.ts']};
