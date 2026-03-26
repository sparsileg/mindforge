if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('Service Worker registered:', reg.scope);
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' &&
                            navigator.serviceWorker.controller &&
                            reg.waiting) {
                            window.uiManager.showToast(
                                'Update available — reload to get the latest version.',
                                'info'
                            );
                        }
                    });
                });
            })
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}
