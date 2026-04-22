On the server, LibreOffice must be installed. The conversion command is:
bashlibreoffice --headless --convert-to pdf --outdir ./docs ./docs/filename.odt
On Ubuntu/Debian: apt install libreoffice. On Windows: path to soffice.exe in the exec call.


cd webpages/iso
npm install
node server.js
# → http://localhost:3000