import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Database,
  Upload,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RefreshCw,
  FileUp,
  Loader2
} from 'lucide-react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Progress } from '../../components/ui/progress';
import { toast } from 'sonner';
import {
  getVectorDatabases,
  rebuildVectorIndex,
  VectorDatabase,
  VectorsResponse
} from '../../lib/api/admin';

export function VectorsPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('clinical-guidelines');
  const [apiData, setApiData] = useState<VectorsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  // 從 API 載入數據
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getVectorDatabases();
      setApiData(data);
    } catch (err) {
      console.error('載入向量資料庫失敗:', err);
      setError('無法連線至伺服器，請確認後端服務是否正常運行');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 使用 API 數據
  const vectorDatabases = apiData?.databases || [];

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === 'application/pdf') {
        setSelectedFile(file);
        toast.success(`已選擇檔案：${file.name}`);
      } else {
        toast.error('請選擇 PDF 格式的檔案');
        event.target.value = '';
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error('請先選擇檔案');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    // 模擬上傳進度
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 10;
      });
    }, 300);

    try {
      // Upload endpoint is not yet available in backend
      // Simulate upload progress for now
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (uploadProgress >= 100) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        // Auto-resolve after 3 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 3000);
      });
      clearInterval(interval);
      setUploadProgress(100);
      toast.info('上傳功能尚未啟用，請等待後端實作完成');
    } catch (err) {
      clearInterval(interval);
      setUploadProgress(0);
      console.error('上傳失敗:', err);
      toast.error('上傳失敗，請確認後端服務是否正常運行');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setSelectedFile(null);

      // 重置檔案輸入
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    }
  };

  const handleRefreshDatabase = async (dbId: string) => {
    toast.info('正在重建向量索引...');

    try {
      await rebuildVectorIndex();
      toast.success('向量索引重建完成');
      loadData();
    } catch (err) {
      console.error('重建索引失敗:', err);
      toast.error('重建索引失敗，請確認後端服務是否正常運行');
    }
  };

  const getStatusBadge = (status: VectorDatabase['status']) => {
    switch (status) {
      case 'active':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            正常運行
          </Badge>
        );
      case 'updating':
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-200">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            更新中
          </Badge>
        );
      case 'error':
        return (
          <Badge className="bg-red-100 text-red-800 border-red-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            異常
          </Badge>
        );
    }
  };

  return (
    <div className="p-6 space-y-6 pl-16">
      <div>
        <h1 className="text-3xl font-bold text-[#3c7acb]">向量資料庫管理</h1>
        <p className="text-muted-foreground mt-1">管理 AI 助手的知識庫與文件向量化</p>
      </div>

      {/* 文件上傳區 */}
      <Card className="border-2 border-[#7f265b]">
        <CardHeader className="bg-[#f8f9fa]">
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileUp className="h-6 w-6 text-[#7f265b]" />
            上傳 PDF 文件
          </CardTitle>
          <CardDescription className="text-[15px] mt-2">
            上傳 PDF 格式的醫療文件，系統將自動解析並嵌入向量資料庫供 AI 查詢使用
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="database-select" className="text-[16px] font-medium">
              選擇目標資料庫
            </Label>
            <select
              id="database-select"
              value={selectedDatabase}
              onChange={(e) => setSelectedDatabase(e.target.value)}
              className="w-full px-3 py-2 border-2 border-[#e5e7eb] rounded-lg focus:border-[#7f265b] focus:outline-none text-[16px]"
              disabled={isUploading}
            >
              {vectorDatabases.map((db) => (
                <option key={db.id} value={db.id}>
                  {db.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file-upload" className="text-[16px] font-medium">
              選擇檔案
            </Label>
            <div className="flex gap-3">
              <Input
                id="file-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                disabled={isUploading}
                className="flex-1 border-2 cursor-pointer"
              />
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                className="bg-[#7f265b] hover:bg-[#631e4d] min-w-[120px]"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    上傳中...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    上傳
                  </>
                )}
              </Button>
            </div>
          </div>

          {selectedFile && (
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertDescription>
                已選擇：{selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
              </AlertDescription>
            </Alert>
          )}

          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">上傳進度</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 向量資料庫列表 */}
      <Card className="border-2">
        <CardHeader className="bg-[#f8f9fa] border-b-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Database className="h-6 w-6 text-[#7f265b]" />
            向量資料庫清單
          </CardTitle>
          <CardDescription className="text-[15px] mt-2">
            當前系統中的所有向量資料庫及其狀態
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
              <p>載入中...</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
              <p className="text-red-600 font-medium">{error}</p>
              <Button variant="outline" className="mt-4" onClick={loadData}>
                重新載入
              </Button>
            </div>
          )}

          {!loading && !error && vectorDatabases.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>尚無向量資料庫</p>
            </div>
          )}

          <div className="divide-y">
            {vectorDatabases.map((db) => (
              <div key={db.id} className="p-6 hover:bg-[#f8f9fa] transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-semibold text-[#1a1a1a]">{db.name}</h3>
                      {getStatusBadge(db.status)}
                    </div>
                    <p className="text-[15px] text-muted-foreground mb-3">{db.description}</p>
                    
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-white border-2 border-[#e5e7eb] rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">文件數量</p>
                        <p className="text-lg font-bold text-[#7f265b]">{db.documentCount}</p>
                      </div>
                      <div className="bg-white border-2 border-[#e5e7eb] rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">資料庫大小</p>
                        <p className="text-lg font-bold text-[#7f265b]">{db.size}</p>
                      </div>
                      <div className="col-span-2 bg-white border-2 border-[#e5e7eb] rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          最後更新時間
                        </p>
                        <p className="text-[15px] font-medium text-[#1a1a1a]">{db.lastUpdated}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRefreshDatabase(db.id)}
                      disabled={db.status === 'updating'}
                      className="border-[#7f265b] text-[#7f265b] hover:bg-[#7f265b] hover:text-white"
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${db.status === 'updating' ? 'animate-spin' : ''}`} />
                      重建索引
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      清空資料庫
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 說明資訊 */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-[15px]">
          <strong>注意事項：</strong>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>上傳的 PDF 文件將被自動解析並轉換為向量嵌入</li>
            <li>文件處理需要一定時間，請耐心等待</li>
            <li>建議定期重建索引以優化查詢效能</li>
            <li>清空資料庫操作無法復原，請謹慎使用</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
