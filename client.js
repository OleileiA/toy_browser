const net = require("net");

class Request {

    constructor(options) {
        this.method = options.method || "GET";
        this.host = options.host;
        this.port = options.port || 80;
        this.path = options.path || '/';
        this.body = options.body || {};
        this.headers = options.headers || {};
        if (!this.headers["Content-Type"]) {
            this.headers["Content-Type"] = "application/x-www-form-urlencoded";
        }
        // 请求体
        if (this.headers["Content-Type"] === "application/json") {
            this.bodyText = JSON.stringify(this.body);
        }
        else if (this.headers["Content-Type"] === "application/x-www-form-urlencoded") {
            this.bodyText = Object.keys(this.body).map(key => `${key}=${encodeURIComponent(this.body[key])}`).join("&");
        }
        this.headers["Content-Length"] = this.bodyText.length;
    }

    toString() {
        return `${this.method} ${this.path} HTTP/1.1\r
${Object.keys(this.headers).map(key => `${key}:${this.headers[key]}`).join("\r\n")}\r
\r
${this.bodyText}`
    }

    send(connection) {
        return new Promise((resolve, reject) => {
            const responseParser = new ResponseParser();
            if (connection)
                connection.write(this.toString());
            else
                connection = net.createConnection({
                    host: this.host,
                    port: this.port
                }, () => {
                    connection.write(this.toString());
                })

            // data事件接收到一段流，不一定是完整的response
            connection.on('data', (data) => {
                responseParser.receive(data.toString());
                if (responseParser.isFinished) {
                    resolve(responseParser.response)
                }
                connection.end();
            });
            connection.on('err', (err) => {
                reject(err);
            });
        })
    }

}

class Response {

}

// 状态机，解析http response
// http response 三段：status-line / headers / body
class ResponseParser {

    constructor() {
        this.WAITING_STATUS_LINE = 0;
        this.WAITING_STATUS_LINE_END = 1;
        this.WAITING_HEADER_NAME = 2;
        this.WAITING_HEADER_SPACE = 3
        this.WAITING_HEADER_VALUE = 4;
        this.WAITING_HEADER_LINE_END = 5;
        this.WAITING_HEADER_BLOCK_END = 6;
        this.WAITING_BODY = 7;
        this.current = this.WAITING_STATUS_LINE; // 当前状态
        this.statusLine = "";
        this.headers ={};
        this.headerName = "";
        this.headerValue = "";
        this.bodyParser = null;
    }

    receive(string) {
        string.split("").map(char => this.receiveChar(char));
    }

    // 状态机开始判断，组装出我们解析后的数据
    receiveChar(char) {
        if (this.current === this.WAITING_STATUS_LINE) {
            if (char === '\r')
                this.current = this.WAITING_STATUS_LINE_END;
            else if (char === '\n')
                this.current = this.WAITING_HEADER_NAME;
            else
                this.statusLine += char;
        }
        else if (this.current === this.WAITING_STATUS_LINE_END) {
            if (char === '\n') this.current = this.WAITING_HEADER_NAME;
        }
        else if (this.current === this.WAITING_HEADER_NAME) {
            if (char === ':') {
                this.current = this.WAITING_HEADER_SPACE;
            }
            else if (char === '\r') {//本来应该是头键字段，结果是\r说明，头部字段结束
                this.current = this.WAITING_HEADER_BLOCK_END;
                if (this.headers['Transfer-Encoding'] === 'chunked') this.bodyParser = new TrunkedBodyParser();
            }
            else {
                this.headerName += char;
            }
        }
        else if (this.current === this.WAITING_HEADER_SPACE) {
            if (char === ' ') {
                this.current = this.WAITING_HEADER_VALUE;
            }
        }
        else if (this.current === this.WAITING_HEADER_VALUE) {
            if (char === '\r') {
                this.current = this.WAITING_HEADER_LINE_END;
                this.headers[this.headerName] = this.headerValue;
                this.headerName = "";
                this.headerValue = "";
            } else {
                this.headerValue += char;
            }
        }
        else if (this.current === this.WAITING_HEADER_LINE_END) {
            if (char === '\n') this.current = this.WAITING_HEADER_NAME;
        }
        else if (this.current === this.WAITING_HEADER_BLOCK_END) {
            if (char === '\n') this.current = this.WAITING_BODY;
        }
        else if (this.current === this.WAITING_BODY) {
            this.bodyParser.receiveChar(char);
        }
    }

    get isFinished() {
        return this.bodyParser && this.bodyParser.isFinished;
    }

    get response() {
        this.statusLine.match(/HTTP\/1.1 ([0-9]+) ([\s\S]+)/)
        return {
            statusCode: RegExp.$1,
            statusText: RegExp.$2,
            headers: this.headers,
            body: this.bodyParser.content.join(''),
        }
    }
}

// body的状态机
class TrunkedBodyParser {

    constructor() {
        this.body = "";
        this.WAITING_LENGTH = 0;
        this.WAITING_LENGTH_LINE_END = 1;
        this.READING_TRUNK = 2;
        this.WAITING_NEW_LINE = 3;
        this.WAITING_NEW_LINE_END = 4;
        this.length = 0;
        this.content = [];
        this.isFinished = false;
        this.current = this.WAITING_LENGTH;
    }

    receiveChar(char) {
        if (this.current === this.WAITING_LENGTH) {
            if (char === '\r') {
                if (this.length === 0) {
                    this.isFinished = true;
                }
                this.current = this.WAITING_LENGTH_LINE_END;
            } else {
                this.length *= 10;
                this.length += char.charCodeAt(0) - '0'.charCodeAt(0);
            }
        }
        else if (this.current === this.WAITING_LENGTH_LINE_END) {
            if (char === '\n') {
                this.current = this.READING_TRUNK;
            }
        }
        else if (this.current === this.READING_TRUNK) {
            this.content.push(char);
            this.length--;
            if (this.length === 0) this.current = this.WAITING_NEW_LINE;
        }
        else if (this.current === this.WAITING_NEW_LINE) {
            if (char === '\r') this.current = this.WAITING_NEW_LINE_END;
        }
        else if (this.current === this.WAITING_NEW_LINE_END) {
            if (char === '\n') {
                this.current = this.WAITING_LENGTH;
            }
        }
    }

}

// 调用
void (async function () {
    const request = new Request({
        method: "POST",
        host: '127.0.0.1',
        port: 8088,
        path: '/',
        headers: {
            ["X-Foo"]: "costumed"
        },
        body: {
            name: 'Winter'
        }
    })
    let res = await request.send();
    console.log(res);
})();
