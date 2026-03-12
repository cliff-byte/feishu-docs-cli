import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocUrl } from '../src/utils/url-parser.js';

describe('parseDocUrl', () => {
  describe('URL parsing', () => {
    it('should parse wiki URL', () => {
      const result = parseDocUrl('https://xxx.feishu.cn/wiki/wikcnJYpnmIFbVfc3Jfvz4hAFab');
      assert.deepEqual(result, { type: 'wiki', token: 'wikcnJYpnmIFbVfc3Jfvz4hAFab' });
    });

    it('should parse docx URL', () => {
      const result = parseDocUrl('https://xxx.feishu.cn/docx/Isy8dJpZZoMvSSxE7mdcACqNnLe');
      assert.deepEqual(result, { type: 'docx', token: 'Isy8dJpZZoMvSSxE7mdcACqNnLe' });
    });

    it('should parse doc URL (legacy)', () => {
      const result = parseDocUrl('https://xxx.feishu.cn/doc/doccnAbc123Def456Ghi789');
      assert.deepEqual(result, { type: 'doc', token: 'doccnAbc123Def456Ghi789' });
    });

    it('should parse sheets URL', () => {
      const result = parseDocUrl('https://xxx.feishu.cn/sheets/shtcnAbcDef123456');
      assert.deepEqual(result, { type: 'sheet', token: 'shtcnAbcDef123456' });
    });

    it('should parse base URL', () => {
      const result = parseDocUrl('https://xxx.feishu.cn/base/bascnAbcDef123456');
      assert.deepEqual(result, { type: 'bitable', token: 'bascnAbcDef123456' });
    });

    it('should parse Lark URL', () => {
      const result = parseDocUrl('https://xxx.larksuite.com/wiki/wikcnAbc123');
      assert.deepEqual(result, { type: 'wiki', token: 'wikcnAbc123' });
    });

    it('should parse larkoffice URL', () => {
      const result = parseDocUrl('https://xxx.larkoffice.com/docx/Abc123Def456');
      assert.deepEqual(result, { type: 'docx', token: 'Abc123Def456' });
    });

    it('should ignore query params and hash', () => {
      const result = parseDocUrl('https://xxx.feishu.cn/wiki/wikcnToken123?lang=zh#section1');
      assert.deepEqual(result, { type: 'wiki', token: 'wikcnToken123' });
    });

    it('should trim whitespace', () => {
      const result = parseDocUrl('  https://xxx.feishu.cn/wiki/wikcnToken123  ');
      assert.deepEqual(result, { type: 'wiki', token: 'wikcnToken123' });
    });
  });

  describe('raw token parsing', () => {
    it('should parse raw token starting with letter', () => {
      const result = parseDocUrl('Isy8dJpZZoMvSSxE7mdcACqNnLe');
      assert.deepEqual(result, { type: 'unknown', token: 'Isy8dJpZZoMvSSxE7mdcACqNnLe' });
    });

    it('should parse wiki-style token', () => {
      const result = parseDocUrl('wikcnJYpnmIFbVfc3Jfvz4hAFab');
      assert.deepEqual(result, { type: 'unknown', token: 'wikcnJYpnmIFbVfc3Jfvz4hAFab' });
    });
  });

  describe('error cases', () => {
    it('should throw on empty input', () => {
      assert.throws(() => parseDocUrl(''), /缺少文档 URL 或 token/);
    });

    it('should throw on null input', () => {
      assert.throws(() => parseDocUrl(null), /缺少文档 URL 或 token/);
    });

    it('should throw on unsupported domain', () => {
      assert.throws(
        () => parseDocUrl('https://example.com/wiki/token123'),
        /不支持的域名/
      );
    });

    it('should throw on unrecognized path', () => {
      assert.throws(
        () => parseDocUrl('https://xxx.feishu.cn/unknown/path'),
        /无法识别的 URL 路径/
      );
    });

    it('should throw on invalid input', () => {
      assert.throws(
        () => parseDocUrl('123'),
        /无法识别的输入/
      );
    });

    it('should throw on short token', () => {
      assert.throws(
        () => parseDocUrl('abc'),
        /无法识别的输入/
      );
    });
  });
});
