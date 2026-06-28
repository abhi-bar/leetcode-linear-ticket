import path from "node:path";
import process from "node:process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import fs from "fs";
import { arch } from "node:os";
import dotenv from "dotenv";
dotenv.config();


const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

// Linear config
const linearEndpoint = "https://api.linear.app/graphql";
const teamsId = getTeamId()

// Mapping (1 - 1) for simplicity
// backlog -> backlog
// started (ui in-progress) -> started
// completed -> completed

let credentials;

try {
    credentials = JSON.parse(fs.readFileSync("./credentials.json"));
} catch (err) {
    console.log("Error reading credentitals file");
}

// object destructuring
const { client_id, client_secret, redirect_uris } = credentials.installed;

const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris
);

// Setting the login
async function auth() {
    // Authenticate with Google and get an authorized client.

    try {
        fs.readFileSync("./token.json");
        const tokens = JSON.parse(fs.readFileSync("token.json"));
        oauth2Client.setCredentials(tokens);

        await oauth2Client.getAccessToken();
    } catch (err) {
        // New login
        const auth = await authenticate({
            keyfilePath: CREDENTIALS_PATH,
            scopes: SCOPES,
        });

        const token = auth.credentials;
        // JSON.stringify(value, replacer, space);
        fs.writeFileSync("./token.json", JSON.stringify(token, null, 2));

        const tokens = JSON.parse(fs.readFileSync("token.json"));
        oauth2Client.setCredentials(tokens);
    }
}

async function getSheetData() {
    await auth();

    // Create a new Sheets API client.
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    // Get the values from the spreadsheet.
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: process.env.SPREADSHEET_RANGE,
    });

    // Currently contains (question, link, status)
    const dataArr = result.data.values;

    if (dataArr.length === 0) {
        console.log("Empty sheet");
        return;
    }

    let sheetArr = [];
    let ini = 1;

    for (let arr of dataArr) {
        // add in array
        sheetArr.push({
            status: arr[2],
            address: "C" + ini++,
            data: {
                question: arr[0],
                link: arr[1],
            },
        });
    }

    return sheetArr;
}

async function updateSpreadsheet() {

    await auth();
    // Create a new Sheets API client.
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    // Get the values from the spreadsheet.
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: process.env.SPREADSHEET_RANGE,
    });


    // Custom derived (future from ENV)
    let size = 3;

    const sheetArr = await getSheetData();

    // Call linear.app api
    const [linearGetArr, countActive] = await getLinearProjects();

    // Update Spreadsheet

    // 0 (n + m)
    // 1. create a map from the sheerArr
    // arr.map() -> just creates a new array of that form
    // new Map() -> creates a "MAP" data structure
    const sheetMap = new Map(
        sheetArr.map((obj) => {
            return [obj.data.question, obj];
        })
    );

    for (let obj of linearGetArr) {
        // find question of obj(linear) in sheetMap
        console.log(obj.data.question);
        const foundObj = sheetMap.get(obj.data.question);

        if (!foundObj) {
            console.log("question does not exist");
            continue;
        } else {
            console.log("entered here");
            // check status
            if (foundObj.status !== obj.status) {
                // Update spreadsheet
                // Update SheetArr-Location with LinearArr-Status
                sheets.spreadsheets.values.update({
                    spreadsheetId:
                        process.env.SPREADSHEET_ID,
                    range: foundObj.address,
                    valueInputOption: "RAW",
                    requestBody: {
                        values: [[obj.status]],
                    },
                });

                foundObj.status = obj.status;
            }
        }
    }

    // Check Active in linearArr
    // If less than required then Add more questions
    if (countActive < size) {
        let required = size - countActive;
        const newSheetArr = await getSheetData();

        const newLinearCreate = [];

        for (let obj of newSheetArr) {
            if (obj.status === "backlog" && required > 0) {
                newLinearCreate.push(obj);
                required--;
            }
        }

        await addQuestion(newLinearCreate);
    }
}

async function getLinearProjects() {
    const query = `query Projects($filter: ProjectFilter) {
                    projects(filter: $filter) {
                        nodes {
                        name
                        status {
                            type
                        }
                        labels {
                            nodes {
                            name
                            }
                        }
                        }
        }
    }`;

    // Here contains: "leetcode" is kept constant
    const variables = {
        filter: {
            labels: {
                name: {
                    contains: "leetcode",
                },
            },
        },
    };

    // array of completed and other a array of other status
    const linearGetArr = [];

    let countActive = 0;

    try {
        const response = await fetch(linearEndpoint, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                Authorization:
                    process.env.LINEAR_API_KEY,
            },
            body: JSON.stringify({ query, variables }),
        });

        const { data, errors } = await response.json();

        for (let obj of data.projects.nodes) {
            console.log(obj);
            const question = obj.name;
            const status = obj.status.type;
            let location;

            for (let label of obj.labels.nodes) {
                if (label.name !== "leetcode") {
                    location = label.name;
                }
            }

            if (status === "started" || status === "backlog") {
                countActive++;
            }

            linearGetArr.push({
                status: obj.status.type,
                address: location,
                data: {
                    question: obj.name,
                },
            });
        }

        if (errors) {
            console.log("GraphQL Errors:", errors);
        }
    } catch (err) {
        console.log("Error: ", err);
    }

    return [linearGetArr, countActive];
}

async function addQuestion(sheetArr) {
    // sheetArr.push({
    //         status: arr[2],
    //         address: "C" + ini++,
    //         data: {
    //             question: arr[0],
    //             link: arr[1],
    //         },
    //     });

    for (let arr of sheetArr) {
        const project = arr.data.question;
        const content = arr.data.link;

        const label1 = "leetcode";

        const labelID = await getOrCreateLabel(label1);

        const query = `
            mutation ProjectCreate($input: ProjectCreateInput!) {
                projectCreate(input: $input) {
                    project {
                        id
                        name
                    }
            }}`;

        console.log(teamsId, project, content, labelID);

        const variables = {
            input: {
                teamIds: [teamsId],
                name: project,
                content: content,
                labelIds: [labelID],
            },
        };

        try {
            const response = await fetch(linearEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization:
                        process.env.LINEAR_API_KEY,
                },
                body: JSON.stringify({ query, variables }),
            });

            const { data, errors } = await response.json();

            if (errors) {
                console.error("GraphQL Errors:", errors);
            } else {
                console.log("task done");
            }
        } catch (err) {
            console.error("Network Error:", err);
        }
    }
}

async function getOrCreateLabel(name) {
    const query = `
            query {
                projectLabels {
                    nodes {
                        id
                        name
                    }
                }
            }
            `;

    const getResponse = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: process.env.LINEAR_API_KEY,
        },
        body: JSON.stringify({ query }),
    });

    const getResult = await getResponse.json();

    const projectLabelMap = new Map(
        getResult.data.projectLabels.nodes.map((label) => [
            label.name.toLowerCase(),
            label,
        ])
    );


    let label = projectLabelMap.get(name);

    console.log(projectLabelMap);

    console.log(label) //-> undefined

    if (label) {
        console.log("entered-here")
        return label.id;
    }

    const mutation = `
        mutation CreateProjectLabel($input: ProjectLabelCreateInput!) {
            projectLabelCreate(input: $input) {
                success
                projectLabel {
                    id
                    name
                }
            }
        }
    `;

    const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: process.env.LINEAR_API_KEY,
        },
        body: JSON.stringify({
            query: mutation,
            variables: {
                input: {
                    name,
                },
            },
        }),
    });

    const result = await response.json();

    if (result.errors) {
        throw new Error(JSON.stringify(result.errors));
    }

    label = result.data.projectLabelCreate.projectLabel;

    projectLabelMap.set(key, label);

    return label.id;
}


async function getTeamId() {
    const query = `
        query {
            teams {
                nodes {
                    id
                }
            }
        }
    `;

    const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: process.env.LINEAR_API_KEY,
        },
        body: JSON.stringify({ query }),
    });

    const result = await response.json();

    if (result.errors) {
        throw new Error(result.errors[0].message);
    }

    const teams = result.data.teams.nodes;

    if (!teams || teams.length === 0) {
        throw new Error("No teams found for this Linear workspace.");
    }

    return teams[0].id;
}

await updateSpreadsheet();
