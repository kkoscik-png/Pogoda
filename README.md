# BALTIC — weather.seasync.co

Aplikacja pogodowa dla BW Ventspils, Ventspils Berth i Norvik Berth. Gałąź zawiera wyłącznie aplikację pogodową; wszystkie pliki aplikacji są w katalogu głównym repozytorium.

Wersja na własnym Cloudflare działa **bez logowania i kodu PIN**. Każdy znający adres może ją otworzyć. Worker nie wymaga Cloudflare Access, TEAM ani AUD. Klucz Stormglass pozostaje sekretem serwerowym. Oddzielny podgląd Sites zachowuje swoje dotychczasowe ustawienia dostępu.

## Wdrożenie przez panel Cloudflare

Ustaw Root directory `/`. Pliki `package.json` i `wrangler.jsonc` są bezpośrednio w głównym katalogu gałęzi `weather-ciswing-co`.

1. Sprawdź, czy domena `seasync.co` jest aktywna na Twoim koncie Cloudflare.
2. W Workers & Pages utwórz aplikację Worker z repozytorium GitHub `kkoscik-png/Pogoda`.
3. Wybierz gałąź produkcyjną `weather-ciswing-co` i katalog główny `/` (główny katalog repozytorium).
4. Ustaw nazwę Workera `baltic-weather`, polecenie budowania `npm test`, polecenie wdrożenia `npm run deploy`. Instalacja zależności: `npm ci` (jeśli panel pokazuje osobne pole).
5. Wdróż. Konfiguracja `wrangler.jsonc` deklaruje Custom Domain `weather.seasync.co`. Jeśli pojawi się konflikt istniejącego rekordu lub aplikacji, sprawdź, co już obsługuje ten adres, przed zastąpieniem.
6. Nie twórz aplikacji Cloudflare Access ani logowania PIN dla tej strony. Jeśli wcześniej utworzono ochronę Access obejmującą ten host, wyłącz ją dla `weather.seasync.co`. Samo wdrożenie kodu nie usuwa osobnej polityki Access na brzegu sieci.
7. Dodaj sekret Stormglass zgodnie z następną sekcją.

Kod jest przygotowany do wdrożenia. Sam zapis w GitHubie nie potwierdza, że domena i produkcyjny Worker zostały już zaktualizowane.

## Stormglass

Po wdrożeniu: Workers & Pages → baltic-weather → Settings → Variables and Secrets → Add → Secret. Nazwa: `STORMGLASS_API_KEY`; wartość: Twój klucz Stormglass. Zapisz i zastosuj zmianę. Dodaj go do środowiska działającego Workera, nie tylko środowiska budowania. Sekret z podglądu Sites nie przenosi się automatycznie na własne konto Cloudflare.

W aplikacji wybierz źródło fali `Stormglass AI`. Domyślnie pobierane są trzy pozycje portowe, a odpowiedzi są buforowane przez sześć godzin. Pełna siatka trasy wymaga `STORMGLASS_ROUTE_ENABLED=true` i odpowiedniego limitu konta: obejmuje 59 pozycji. Przy limicie 10 zapytań dziennie pozostaw tę opcję wyłączoną.

## Wdrożenie z terminala

```bash
npm ci
npm test
npx wrangler login
npm run deploy
npx wrangler secret put STORMGLASS_API_KEY
```

Logowanie Wrangler służy zarządzaniu kontem Cloudflare. Odwiedzający stronę nie logują się.

## Weryfikacja

- `weather.seasync.co` otwiera aplikację w prywatnym oknie przeglądarki bez przekierowania do Access i bez PIN-u.
- Mapa, wykres i źródła pogody działają.
- `/api/stormglass/status` zwraca `configured: true` po dodaniu sekretu, bez jego wartości.
- Kod i zasoby przeglądarki nie zawierają klucza Stormglass.
- Domeny `workers.dev` oraz podglądy pozostają wyłączone.

Sprawdzenie lokalne: `npm test` oraz `npm run build:check`. Szczegóły funkcji aplikacji: [APP_NOTES.md](APP_NOTES.md).
