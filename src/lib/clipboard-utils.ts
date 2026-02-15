/**
 * 安全的剪貼簿複製工具
 * 處理瀏覽器權限和相容性問題
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  // 先檢測是否可以使用 Clipboard API
  const canUseClipboardAPI = !!(
    navigator.clipboard && 
    navigator.clipboard.writeText &&
    // 檢查是否在安全上下文中（HTTPS 或 localhost）
    window.isSecureContext
  );

  // 如果可以使用 Clipboard API，嘗試使用
  if (canUseClipboardAPI) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // 靜默處理錯誤，直接降級到 fallback
      // 不在控制台顯示錯誤訊息，避免混淆使用者
    }
  }
  
  // 使用降級方案：傳統的 execCommand
  return fallbackCopyToClipboard(text);
}

function fallbackCopyToClipboard(text: string): boolean {
  try {
    // 創建臨時 textarea
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // 防止鍵盤彈出和滾動
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0';
    textArea.setAttribute('readonly', ''); // 防止移動裝置鍵盤彈出
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    // 嘗試複製
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    return successful;
  } catch (error) {
    // 靜默處理錯誤
    return false;
  }
}

/**
 * 複製文字並顯示結果訊息
 */
export async function copyWithFeedback(
  text: string,
  onSuccess?: () => void,
  onError?: () => void
): Promise<void> {
  const success = await copyToClipboard(text);
  
  if (success) {
    if (onSuccess) {
      onSuccess();
    }
  } else {
    if (onError) {
      onError();
    }
  }
}