const net = require("net");

class Request {

}
class Response {

}


const client = net.createConnection({
    host: '127.0.0.1',
    port: 8088
}, () => {
    client.write(`POST / HTTP/1.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 11\r\n\r\nname=winter`);
});
client.on('data', (data) => {
    console.log(data.toString());
    client.end();
});
client.on('end', () => {
    console.log('disconnected from server');
});
