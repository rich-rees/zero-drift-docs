def summarise(conn):
    return conn.execute("SELECT count(*) FROM offers")
