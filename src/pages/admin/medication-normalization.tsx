import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { FileJson, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../lib/api-client';
import {
  getMedicationNormalizationConfig,
  updateMedicationNormalizationConfig,
  type MedicationNormalizationConfig,
} from '../../lib/api/admin';

function toPrettyJson(value: Record<string, string>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseAliasJson(raw: string, fieldName: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${fieldName} JSON 格式錯誤`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必須是 JSON 物件`);
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(k || '').trim();
    const value = String(v ?? '').trim();
    if (!key || !value) {
      throw new Error(`${fieldName} key/value 不可為空`);
    }
    out[key] = value;
  }
  return out;
}

export function MedicationNormalizationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MedicationNormalizationConfig | null>(null);
  const [version, setVersion] = useState('');
  const [routeAliasesText, setRouteAliasesText] = useState('{}\n');
  const [frequencyAliasesText, setFrequencyAliasesText] = useState('{}\n');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMedicationNormalizationConfig();
      setConfig(data);
      setVersion(data.version);
      setRouteAliasesText(toPrettyJson(data.routeAliases));
      setFrequencyAliasesText(toPrettyJson(data.frequencyAliases));
    } catch (err) {
      setError(getApiErrorMessage(err, '載入用藥標準化字典失敗'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const hasLocalChange = useMemo(() => {
    if (!config) return false;
    return (
      version !== config.version ||
      routeAliasesText.trim() !== toPrettyJson(config.routeAliases).trim() ||
      frequencyAliasesText.trim() !== toPrettyJson(config.frequencyAliases).trim()
    );
  }, [config, version, routeAliasesText, frequencyAliasesText]);

  const handleSave = async () => {
    try {
      const routeAliases = parseAliasJson(routeAliasesText, 'routeAliases');
      const frequencyAliases = parseAliasJson(frequencyAliasesText, 'frequencyAliases');
      const normalizedVersion = version.trim();
      if (!normalizedVersion) {
        toast.error('version 不可為空');
        return;
      }

      setSaving(true);
      const data = await updateMedicationNormalizationConfig({
        version: normalizedVersion,
        routeAliases,
        frequencyAliases,
      });
      setConfig(data);
      setVersion(data.version);
      setRouteAliasesText(toPrettyJson(data.routeAliases));
      setFrequencyAliasesText(toPrettyJson(data.frequencyAliases));
      toast.success('用藥標準化字典已更新');
    } catch (err) {
      const message = err instanceof Error ? err.message : getApiErrorMessage(err, '更新失敗');
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1>用藥標準化字典</h1>
          <p className="text-muted-foreground mt-1">管理 route/frequency 正規化規則（Layer2 建置使用）</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadConfig} disabled={loading || saving}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重新載入
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || !hasLocalChange} className="bg-[#7f265b] hover:bg-[#631e4d]">
            <Save className="mr-2 h-4 w-4" />
            儲存
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Route Alias</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{config?.routeAliasCount ?? 0} 條</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Frequency Alias</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{config?.frequencyAliasCount ?? 0} 條</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">版本</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-[#7f265b] text-white">{config?.version || '-'}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileJson className="h-5 w-5 text-[#7f265b]" />
            字典編輯
          </CardTitle>
          <CardDescription>請輸入合法 JSON object，key/value 皆為字串。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dict-version">version</Label>
            <Input
              id="dict-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={loading || saving}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="route-aliases">routeAliases (JSON object)</Label>
              <Textarea
                id="route-aliases"
                value={routeAliasesText}
                onChange={(e) => setRouteAliasesText(e.target.value)}
                disabled={loading || saving}
                className="min-h-[360px] font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="frequency-aliases">frequencyAliases (JSON object)</Label>
              <Textarea
                id="frequency-aliases"
                value={frequencyAliasesText}
                onChange={(e) => setFrequencyAliasesText(e.target.value)}
                disabled={loading || saving}
                className="min-h-[360px] font-mono text-xs"
              />
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <div>檔案：{config?.filePath || '-'}</div>
            <div>最後更新：{config?.modifiedAt || '-'}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

