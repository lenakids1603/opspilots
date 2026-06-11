// 商品大图预览弹窗（货期交付看板 / 供应商工作台共用，样式同催货清单）。
import { Dialog, DialogContent } from "@/components/ui/dialog";

export interface PreviewImage { url: string; caption: string }

export function ImagePreviewDialog({ preview, onClose }: {
  preview: PreviewImage | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!preview} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl p-2">
        {preview && (
          <div className="flex flex-col items-center gap-2">
            <img src={preview.url} alt={preview.caption} referrerPolicy="no-referrer"
              className="max-h-[80vh] w-auto object-contain rounded" />
            <div className="text-xs text-muted-foreground font-mono pb-2">{preview.caption}</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
