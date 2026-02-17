import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { adviceCategories } from './types';

interface AdviceSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCategory: string;
  selectedAdviceCode: string;
  onCategoryChange: (value: string) => void;
  onAdviceCodeChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AdviceSubmitDialog({
  open,
  onOpenChange,
  selectedCategory,
  selectedAdviceCode,
  onCategoryChange,
  onAdviceCodeChange,
  onConfirm,
  onCancel,
}: AdviceSubmitDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>選擇用藥建議分類</DialogTitle>
          <DialogDescription>
            先選擇大類別，再選擇具體項目
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>步驟 1：選擇大類別</Label>
            <Select value={selectedCategory} onValueChange={onCategoryChange}>
              <SelectTrigger>
                <SelectValue placeholder="請選擇大類別..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(adviceCategories).map(([key, category]) => (
                  <SelectItem key={key} value={key}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedCategory && (
            <div className="space-y-2">
              <Label>步驟 2：選擇具體分類</Label>
              <Select value={selectedAdviceCode} onValueChange={onAdviceCodeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="請選擇具體分類..." />
                </SelectTrigger>
                <SelectContent>
                  {adviceCategories[selectedCategory as keyof typeof adviceCategories].codes.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={onConfirm}
            disabled={!selectedAdviceCode}
            className="bg-[#7f265b] hover:bg-[#631e4d]"
          >
            確認送出
          </Button>
          <Button onClick={onCancel} variant="outline">
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
