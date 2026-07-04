"""
智汇小玉 — Mock 数据模块
当云数据库不可用时，提供空数据壳（不编造假数据）。
"""

MOCK_JOBS = []
MOCK_APPLICATIONS = []


class MockDB:
    """本地 mock 数据库，模拟 CloudDatabaseClient 接口"""

    def query(self, collection, where=None, limit=20, skip=0, **kwargs):
        if collection == "jobs":
            data = MOCK_JOBS
        elif collection == "applications":
            data = MOCK_APPLICATIONS
        elif collection == "accounts":
            data = []
        elif collection == "jobseekers":
            data = []
        else:
            data = []

        # 简单过滤
        if where:
            filtered = []
            for item in data:
                match = True
                for key, value in where.items():
                    if key == "title":
                        # 模糊匹配
                        if value.lower() not in item.get(key, "").lower():
                            match = False
                    elif key == "auditStatus":
                        if item.get(key) != value:
                            match = False
                    elif key == "recruitStatus":
                        if item.get(key) != value:
                            match = False
                    elif key == "area":
                        if item.get(key) != value:
                            match = False
                    elif key == "jobId":
                        if item.get(key) != value:
                            match = False
                    elif key == "jobseekerId":
                        if item.get(key) != value:
                            match = False
                    elif key == "status":
                        if item.get(key) != value:
                            match = False
                    else:
                        if item.get(key) != value:
                            match = False
                if match:
                    filtered.append(item)
            data = filtered

        # skip / limit
        return data[skip:skip + limit]

    def get(self, collection, doc_id):
        data = self.query(collection)
        for item in data:
            if item.get("_id") == doc_id:
                return item
        return None

    def add(self, collection, data):
        return "mock_id_" + str(len(data))

    def update(self, collection, doc_id, data):
        return True

    def count(self, collection, where=None):
        return len(self.query(collection, where))


# 全局 mock 实例
mock_db = MockDB()
