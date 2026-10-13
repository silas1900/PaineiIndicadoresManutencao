# Gestão da Manutenção Corretiva — Dashboard

## Estrutura
```
dashboard-manutencao/
├── index.html
├── style.css
├── script.js
├── README.md
└── lib/            (opcional: cópias locais para uso offline)
    ├── xlsx.full.min.js   (SheetJS 0.18.5)
    └── chart.umd.js       (Chart.js 4.4.1)
```

## Como executar
1. Abra `index.html` com duplo clique (Chrome, Edge ou Firefox). Não precisa de servidor.
2. Clique em **Importar planilha** (ou arraste o arquivo) e selecione `BaseManutenção.xlsx`.

## Bibliotecas externas
- SheetJS (xlsx) e Chart.js, carregadas por CDN (jsDelivr). Para usar offline, baixe os dois arquivos para `lib/`; o `index.html` usa essas cópias automaticamente se a CDN falhar.
- Ícones: SVG embutidos no estilo Lucide (sem dependência). Datas: funções próprias.
- PDF: botão **Gerar PDF** abre a impressão do navegador (layout A4 paisagem próprio); escolha "Salvar como PDF".

Metodologia e limitações dos indicadores: seção "Metodologia" no próprio painel.

## Versão fixa para portfólio
`dashboard-fixo.html` + `dados.js`: mesmos painéis, com os dados da planilha já embutidos (sem upload nem SheetJS). Abra `dashboard-fixo.html`; para publicar, suba `dashboard-fixo.html`, `dados.js`, `script.js` e `style.css`. Para trocar os dados, regere o `dados.js`.
