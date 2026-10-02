# Site local do Firawynix Workspace

Página de apresentação estática, inspirada no site local do Firaw - VidBee. Não exige serviço externo nem conexão com os servidores configurados no Monitor.

Na raiz do repositório, execute:

```powershell
python -m http.server 4176 --bind 127.0.0.1 --directory site
```

Depois abra <http://127.0.0.1:4176/>. A página inicial apresenta o Workspace e leva às páginas próprias do [Firaw - Monitor](monitor.html) e [Firaw - IDE](ide.html), com capturas demonstrativas e links de instalação. A barra inferior permanece fixa e contém os links da Microsoft Store para os três aplicativos, além do repositório público da conta FIRAWYNIX, da política de privacidade e do portfólio.

Os links da Store usam os IDs reservados `9NHPH2BRCXML` (Workspace), `9P60P0V66PN8` (Monitor) e `9N968W52SJKR` (IDE). As páginas públicas podem ficar indisponíveis enquanto os aplicativos estiverem em certificação. As imagens mostram dados simulados e uma comparação local de exemplo.
