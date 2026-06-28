Notes for setup

Node:
1. npm install dotenv googleapis @google-cloud/local-auth


General
1. Google Project (To access sheet)
    a.Go to the Google Cloud Console.
    b.Create a project.
    c.Enable the APIs you need (e.g., Google Sheets API).
    d.Configure the OAuth consent screen.
    e.Create an OAuth Client ID.

1.1 Download the creadentials.json to the same location as the project

// Following values are required to be added in a .env file

2. Linear API key 
    a.Open Linear.app
    b.Go to Settings → Account → Security & Access → Personal API Keys.
    c.Click Create Personal API Key.
    d.Copy the key.
    f.create the below line in .env
        LINEAR_API_KEY=<linear-api-key>


3. Spreadheet ID
    a.
        https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456789/edit#gid=0
        The spreadsheet ID is the part between /d/ and /edit
    b. make sure its editable for all
    c.create the below line in .env
        SPREADSHEET_ID=<spreadsheet-id>

3.1 Spreadsheet Range
    a. Spreadsheet schema
        <question, link, status[backlog]>
    b. consider the range from start to the end: eg- A1:C10
