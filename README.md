# Pogoda — aplikacja pogodowa na Androida

Natywna aplikacja w Kotlinie z Jetpack Compose. Korzysta z **Open-Meteo** —
darmowego API pogodowego, które **nie wymaga klucza ani rejestracji**.

## Co potrafi

- aktualna pogoda dla lokalizacji z GPS (z obsługą uprawnień w czasie działania),
- wyszukiwarka miast na całym świecie (z opóźnieniem 300 ms, żeby nie zasypywać API),
- prognoza godzinowa na 24 h,
- prognoza na 7 dni z paskiem zakresu temperatur,
- tryb jasny i ciemny,
- gradient nagłówka zmieniający się razem z porą dnia i warunkami.

## Jak uruchomić

1. Zainstaluj **Android Studio** (Ladybug lub nowsze).
2. `File → Open…` i wskaż ten katalog.
3. Android Studio dociągnie Gradle Wrapper i zsynchronizuje projekt.
4. `Run ▶` na emulatorze lub telefonie.

> W repozytorium nie ma pliku `gradle/wrapper/gradle-wrapper.jar` (to plik binarny).
> Android Studio wygeneruje go przy pierwszej synchronizacji. Jeśli wolisz z konsoli:
> `gradle wrapper` (przy lokalnie zainstalowanym Gradle), a potem `./gradlew assembleDebug`.

Wersje bibliotek są w `gradle/libs.versions.toml`. Android Studio sam podpowie
nowsze — warto przyjąć te podpowiedzi.

## Struktura

```
app/src/main/java/com/example/pogoda/
├── MainActivity.kt
├── data/
│   ├── Dto.kt               modele JSON (kotlinx.serialization)
│   ├── OpenMeteoApi.kt      interfejsy Retrofit
│   ├── Network.kt           konfiguracja OkHttp + Retrofit
│   ├── Model.kt             modele domenowe
│   ├── WeatherCodes.kt      kody WMO → opis po polsku + emoji
│   └── WeatherRepository.kt pobieranie i mapowanie danych
├── location/
│   └── LocationProvider.kt  FusedLocationProviderClient jako coroutine
└── ui/
    ├── WeatherViewModel.kt  stan ekranu (StateFlow)
    ├── WeatherScreen.kt     całe UI
    └── theme/Theme.kt       paleta, typografia, gradienty
```

## Warto wiedzieć

- `minSdk = 26` — dzięki temu można używać `java.time` bez desugaringu.
  Jeśli potrzebujesz Androida 7, w `app/build.gradle.kts` włącz
  `coreLibraryDesugaringEnabled = true` i dodaj `com.android.tools:desugar_jdk_libs`.
- Czas „teraz" bierzemy z odpowiedzi API (`timezone=auto`), a nie z telefonu —
  dzięki temu prognoza dla Tokio pokazuje godziny tokijskie.
- Aplikacja nie zapisuje niczego na dysku. Kolejne kroki, jeśli chcesz ją rozwijać:
  cache w Room, zapisane lokalizacje, widget na ekran główny, powiadomienia
  o ostrzeżeniach, WorkManager do odświeżania w tle.

## Budowanie bez Android Studio (GitHub Actions)

W repozytorium jest gotowy workflow `.github/workflows/build-apk.yml`.

1. Wrzuć projekt na GitHuba (może być repozytorium prywatne).
2. Wejdź w zakładkę **Actions** i potwierdź uruchamianie workflowów.
3. Build ruszy sam po pushu — albo ręcznie: *Zbuduj APK → Run workflow*.
4. Po ~5 minutach w podsumowaniu builda pojawi się sekcja **Artifacts**
   z plikiem `pogoda-debug-apk` do pobrania.

Artefakt pobiera się jako ZIP — w środku jest `app-debug.apk`.

Limity GitHuba: repozytoria publiczne budują się bez ograniczeń,
prywatne mają 2000 minut miesięcznie w darmowym planie. Ten build zajmuje
kilka minut, więc w praktyce limit nie przeszkadza.
