function purifyUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    
    // 如果是 bilibili.com 视频或番剧或稍后再看页面，进行强净化
    const isBilibili = url.hostname.endsWith('bilibili.com');
    if (isBilibili) {
      const isVideoOrPlay = url.pathname.includes('/video/') || 
                            url.pathname.includes('/bangumi/play/') || 
                            url.pathname.includes('/watchlater/');
      if (isVideoOrPlay) {
        // 对于 B 站视频播放页，通常只需保留 p (分P) 和 t (播放起点时间)
        const keysToKeep = ['p', 't'];
        const keys = Array.from(url.searchParams.keys());
        for (const key of keys) {
          if (!keysToKeep.includes(key.toLowerCase())) {
            url.searchParams.delete(key);
          }
        }
        return url.toString();
      }
    }

    // 通用净化规则：移除常见的跟踪参数
    const trackParams = [
      'trackid', 'track_id', 'caid', 'resource_id', 'source_id', 'request_id', 
      'from_spmid', 'creative_id', 'linked_creative_id', 'vd_source', 
      'spm_id_from', 'from', 'spm', 'scm', 'fbclid', 'gclid', 'hm_parameter'
    ];
    
    const keys = Array.from(url.searchParams.keys());
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      // 匹配 utm_ 开头的参数
      if (lowerKey.startsWith('utm_')) {
        url.searchParams.delete(key);
        continue;
      }
      // 匹配黑名单中的参数
      if (trackParams.includes(lowerKey)) {
        url.searchParams.delete(key);
      }
    }
    
    return url.toString();
  } catch (e) {
    // 如果解析失败，说明不是合法的 URL，原样返回
    return urlStr;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openIncognito') {
    const cleanUrl = purifyUrl(request.url);
    chrome.windows.create({
      url: cleanUrl,
      incognito: true,
      state: 'maximized'
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    modifierKey: 'ctrlKey'
  });
});
