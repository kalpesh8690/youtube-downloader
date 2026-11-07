# Downly Android

Native Expo/React Native Android app for Downly.

## Build an installable APK

```bash
cd mobile
npm install
npx expo install --fix
eas login
eas build:configure
eas build -p android --profile preview
```

The preview profile uses `android.buildType: apk`, so EAS produces an installable APK.

Cloud API: https://youtube-downloader.chauhankalpesh760.workers.dev
Local Termux API: http://127.0.0.1:3000
