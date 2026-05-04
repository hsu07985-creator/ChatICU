import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
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
    throw new Error(i18n.t('admin:medNorm.errors.jsonInvalid', { field: fieldName }));
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(i18n.t('admin:medNorm.errors.mustBeObject', { field: fieldName }));
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(k || '').trim();
    const value = String(v ?? '').trim();
    if (!key || !value) {
      throw new Error(i18n.t('admin:medNorm.errors.kvEmpty', { field: fieldName }));
    }
    out[key] = value;
  }
  return out;
}

export function MedicationNormalizationPage() {
  const { t } = useTranslation('admin');
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
      setError(getApiErrorMessage(err, t('medNorm.errors.loadFail')));
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
        toast.error(t('medNorm.errors.versionEmpty'));
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
      toast.success(t('medNorm.toast.updated'));
    } catch (err) {
      const message = err instanceof Error ? err.message : getApiErrorMessage(err, t('medNorm.errors.updateFail'));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('medNorm.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('medNorm.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadConfig} disabled={loading || saving}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('medNorm.reload')}
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || !hasLocalChange} className="bg-brand hover:bg-brand-hover">
            <Save className="mr-2 h-4 w-4" />
            {t('medNorm.save')}
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
          <CardHeader>
            <CardTitle className="text-base">{t('medNorm.routeAlias')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{t('medNorm.rowCount', { count: config?.routeAliasCount ?? 0 })}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('medNorm.frequencyAlias')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{t('medNorm.rowCount', { count: config?.frequencyAliasCount ?? 0 })}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('medNorm.version')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-brand text-white">{config?.version || '-'}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileJson className="h-5 w-5 text-brand" />
            {t('medNorm.dictEditor')}
          </CardTitle>
          <CardDescription>{t('medNorm.dictEditorDesc')}</CardDescription>
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
            <div>{t('medNorm.fileLabel', { path: config?.filePath || '-' })}</div>
            <div>{t('medNorm.lastModifiedLabel', { at: config?.modifiedAt || '-' })}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

