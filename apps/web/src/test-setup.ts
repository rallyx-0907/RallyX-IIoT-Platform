import { beforeEach } from 'vitest';
import { setLanguage } from './i18n';

// Existing English contract tests run explicitly in English; locale tests opt into Vietnamese.
beforeEach(() => setLanguage('en'));
