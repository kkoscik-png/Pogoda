# BALTIC — weather.seasync.co

Gotowa do przeniesienia wersja aplikacji pogodowej dla BW Ventspils, Ventspils Berth i Norvik Berth. Kopia odpowiada wersji aplikacji z jasną mapą i pełnym pokryciem Ventspils (źródłowy commit Sites: `f48ff9418093e6fb25b9c6f4b5a81eaa14f619fd`).

Ten katalog jest niezależny od starszego projektu Android znajdującego się w katalogu głównym repozytorium.

## Stan

- Kod aplikacji, lokalne biblioteki mapy i testy są przygotowane.
- Docelowy adres w konfiguracji: `weather.seasync.co`.
- Nie potwierdzono wdrożenia w koncie Cloudflare ani własności/aktywnej strefy DNS `seasync.co`.
- Adres docelowy został potwierdzony przez właściciela jako `weather.seasync.co`.
- Bez konfiguracji Access Worker odpowiada 503 i nie udostępnia plików aplikacji.

## Uruchomienie na koncie Cloudflare

1. W Cloudflare sprawdzić, czy strefa `seasync.co` znajduje się na właściwym koncie i ma aktywne serwery nazw. Nie zastępować tego adresu inną domeną bez decyzji właściciela.
2. W Cloudflare One / Access utworzyć aplikację Self-hosted dla dokładnego hosta `weather.seasync.co`. Dodać politykę Allow tylko dla właściciela (adres zweryfikowany na połączonym GitHubie: `k.koscik@gmail.com`).
3. Odczytać domenę zespołu `NAZWA.cloudflareaccess.com` i Application Audience (AUD). Wpisać je w `vars.ACCESS_TEAM_DOMAIN` i `vars.ACCESS_AUD` w `wrangler.jsonc`. To identyfikatory konfiguracji, nie token API Cloudflare. Nie publikować żadnych kluczy ani tokenów w repozytorium.
4. Zalogować Wrangler na właściwe konto i wdrożyć:

```bash
cd weather
npm ci
npm test
npx wrangler login
npm run deploy
```

Wrangler utworzy/powiąże Custom Domain zadeklarowaną w konfiguracji. Przed zatwierdzeniem ewentualnego konfliktu trzeba sprawdzić istniejące DNS/Workers pod tym hostem. Nie usuwać obcych rekordów ani istniejących aplikacji w ciemno.

Alternatywnie w Cloudflare Workers można połączyć repozytorium GitHub, wskazać gałąź `weather-ciswing-co` i katalog główny `weather`. Instalacja: `npm ci`; polecenie wdrożenia: `npm run deploy`. Polityka Access i wartości TEAM/AUD nadal są wymagane. Nie używać samego katalogu `dist` jako niezabezpieczonego publicznego Pages, jeśli aplikacja ma pozostać prywatna.

## Weryfikacja po wdrożeniu

- DNS i HTTPS działają dla `weather.seasync.co`.
- Niezalogowana przeglądarka trafia do logowania Access, a nie do aplikacji.
- Właściciel po zalogowaniu widzi aplikację, dane i animacje.
- Domeny `workers.dev` oraz podglądy są wyłączone.
- Przy pustych TEAM/AUD, braku tokenu i błędnym tokenie nie da się odczytać HTML ani zasobów.

Aktualne działające wdrożenie pozostaje pod adresem https://baltic-wind-wave.idealcrab9.chatgpt.site do czasu potwierdzenia migracji. Szczegóły aplikacji i źródeł pogodowych: [APP_NOTES.md](APP_NOTES.md).

## Stormglass

Po wdrożeniu dodaj w Cloudflare: Workers & Pages → baltic-weather → Settings → Variables and Secrets → Add → Secret. Nazwa: `STORMGLASS_API_KEY`; wartość: klucz z panelu Stormglass. Nie wpisuj klucza do GitHuba ani wrangler.jsonc. Zapisz i zastosuj zmianę środowiska. Następnie w aplikacji wybierz źródło fali `Stormglass AI`.

Domyślnie pobierane są tylko trzy pozycje portowe, a serwer buforuje odpowiedzi przez sześć godzin. Pełna siatka trasy wymaga ustawienia `STORMGLASS_ROUTE_ENABLED=true` i odpowiedniego limitu konta: sama siatka ma 59 pozycji. Z kluczem o limicie 10 zapytań dziennie pozostaw tę opcję wyłączoną. Nie pobieramy danych wszystkich punktów automatycznie.

Szczegóły zakresu, izolacji źródeł i testów znajdują się w APP_NOTES.md. Własny Worker wymaga także wcześniejszej konfiguracji Cloudflare Access. Sekret zapisany w obecnym podglądzie Sites nie jest automatycznie przenoszony do własnego konta Cloudflare.
