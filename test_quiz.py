import urllib.request
import json

data = {
    "transcript": "Hello world this is a test transcript of at least 50 chars so it passes the length check. Here is some math: 1+1=2. Gravity is 9.8m/s2. The sky is blue. Water is wet. Leaves are green. Dogs bark. Cats meow.",
    "lectureTitle": "Test",
    "topicId": "t1",
    "numQuestions": 8,
    "courseLevel": "JEE"
}

req = urllib.request.Request(
    'http://127.0.0.1:8000/quiz/generate',
    data=json.dumps(data).encode('utf-8'),
    headers={'Content-Type': 'application/json', 'X-Tenant-Id': 'test'}
)

try:
    with urllib.request.urlopen(req) as response:
        print(response.read().decode())
except Exception as e:
    print(e)
